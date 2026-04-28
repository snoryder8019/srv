import express from 'express';
import { ObjectId } from 'mongodb';
import { callLLM } from '../../plugins/agentMcp.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET, bucketUrl } from '../../plugins/s3.js';

const router = express.Router();

// ── Word count helper ────────────────────────────────────────────────────────
function wordCount(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

// ── Smart classify + route transcription ────────────────────────────────────
// Short  (<= 60 words)  → MongoDB `shorts` collection
// Rant   (> 60 words)   → Linode Object Storage (.txt) + MongoDB `rants` ref
async function classifyAndStore(db, body, title, clientId, createdBy, s3Prefix) {
  const wc    = wordCount(body);
  const isRant = wc > 60;
  const now   = new Date();

  if (isRant) {
    // ── Upload full text to object storage ──────────────────────────────────
    const ts       = Date.now();
    const rand     = Math.random().toString(36).slice(2, 7);
    const prefix   = s3Prefix || 'default';
    const key      = `${prefix}/rants/${ts}-${rand}.txt`;
    const txtBuf   = Buffer.from(body, 'utf8');

    await s3Client.send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          key,
      Body:         txtBuf,
      ContentType:  'text/plain; charset=utf-8',
      ACL:          'private',
    }), { abortSignal: AbortSignal.timeout(20000) });

    const fileUrl = bucketUrl(key);

    // ── Generate a quick summary for the DB record ──────────────────────────
    let summary = '';
    try {
      summary = await callLLM(
        [{ role: 'user', content: body }],
        'Summarise this in 1-2 plain sentences. No labels, no intro. Start immediately.',
        30000
      );
    } catch { summary = body.slice(0, 200); }

    const doc = {
      title:     (title || '').trim() || body.slice(0, 60),
      summary:   summary.trim(),
      wordCount: wc,
      s3Key:     key,
      s3Url:     fileUrl,
      size:      txtBuf.length,
      clientId:  clientId ? new ObjectId(clientId) : null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const r = await db.collection('rants').insertOne(doc);
    return { type: 'rant', id: r.insertedId, doc };

  } else {
    // ── Store short note in MongoDB ──────────────────────────────────────────
    const doc = {
      title:     (title || '').trim() || body.slice(0, 60),
      body:      body.trim(),
      wordCount: wc,
      clientId:  clientId ? new ObjectId(clientId) : null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const r = await db.collection('shorts').insertOne(doc);
    return { type: 'short', id: r.insertedId, doc };
  }
}

// ── Core tags seed ────────────────────────────────────────────────────────────
const CORE_TAGS = ['business', 'personal', 'ideas', 'tasks', 'finance', 'random'];

async function ensureCoreTags(db) {
  for (const name of CORE_TAGS) {
    await db.collection('note_tags').updateOne(
      { name },
      { $setOnInsert: { name, core: true, createdAt: new Date() } },
      { upsert: true }
    );
  }
}

// ── GET /admin/notes/tags — list all tags with counts ────────────────────────
router.get('/tags', async (req, res) => {
  try {
    await ensureCoreTags(req.db);
    const tags = await req.db.collection('note_tags').find({}).sort({ core: -1, name: 1 }).toArray();
    // Attach counts
    await Promise.all(tags.map(async t => {
      t.count = await req.db.collection('notes').countDocuments({ tags: t.name });
    }));
    res.json({ ok: true, tags });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /admin/notes/tags — create custom tag ───────────────────────────────
router.post('/tags', express.json(), async (req, res) => {
  try {
    const name = (req.body.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!name) return res.status(400).json({ error: 'Name required' });
    const existing = await req.db.collection('note_tags').findOne({ name });
    if (existing) return res.status(409).json({ error: 'Tag already exists' });
    const r = await req.db.collection('note_tags').insertOne({ name, core: false, createdAt: new Date() });
    res.json({ ok: true, tag: { _id: r.insertedId, name, core: false, count: 0 } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /admin/notes/tags/:name — remove custom tag (core tags protected) ─
router.delete('/tags/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const tag = await req.db.collection('note_tags').findOne({ name });
    if (tag?.core) return res.status(403).json({ error: 'Core tags cannot be deleted' });
    await req.db.collection('note_tags').deleteOne({ name });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /admin/notes ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const { tag, client, q } = req.query;
    const filter = {};
    if (tag)    filter.tags = tag;
    if (client) filter.clientId = new ObjectId(client);
    if (q)      filter.$or = [
      { title:  { $regex: q, $options: 'i' } },
      { body:   { $regex: q, $options: 'i' } },
      { tldr:   { $regex: q, $options: 'i' } },
    ];

    await ensureCoreTags(db);

    const [notes, clients, tagDocs] = await Promise.all([
      db.collection('notes').find(filter).sort({ createdAt: -1 }).toArray(),
      db.collection('clients').find({}, { projection: { name: 1, email: 1, company: 1 } }).sort({ name: 1 }).toArray(),
      db.collection('note_tags').find({}).sort({ core: -1, name: 1 }).toArray(),
    ]);

    // Attach note counts to tags
    await Promise.all(tagDocs.map(async t => {
      t.count = await db.collection('notes').countDocuments({ tags: t.name });
    }));

    const clientMap = {};
    clients.forEach(c => { clientMap[c._id.toString()] = c.name || c.company || c.email || 'Client'; });

    res.render('admin/notes/index', {
      user: req.adminUser,
      page: 'notes',
      title: 'Notes',
      notes,
      clients,
      clientMap,
      tagDocs,
      filters: { tag: tag || '', client: client || '', q: q || '' },
    });
  } catch (err) {
    console.error('[notes] list error:', err);
    res.status(500).send('Error loading notes');
  }
});

// ── POST /admin/notes — create + smart-classify ──────────────────────────────
router.post('/', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const { title, body, tags, clientId } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Body required' });

    // ── Always save a full note in the notes collection ──────────────────────
    const result = await db.collection('notes').insertOne({
      title:       (title || '').trim() || 'Untitled Note',
      body:        body.trim(),
      tldr:        null,
      tags:        parseTags(tags),
      clientId:    clientId ? new ObjectId(clientId) : null,
      distributed: [],
      createdBy:   req.adminUser.email,
      createdAt:   new Date(),
      updatedAt:   new Date(),
    });

    // ── Smart classify in background (non-blocking) ──────────────────────────
    const s3Prefix = req.tenant?.s3Prefix;
    const createdBy = req.adminUser.email;

    classifyAndStore(db, body.trim(), title, clientId, createdBy, s3Prefix)
      .then(r => {
        // Backlink the classified doc to the original note
        db.collection('notes').updateOne(
          { _id: result.insertedId },
          { $set: { [`${r.type}Ref`]: r.id, noteType: r.type } }
        ).catch(() => {});
        console.log(`[notes] classified as ${r.type} → ${r.id}`);
      })
      .catch(err => console.error('[notes] classify error:', err.message));

    res.json({ ok: true, id: result.insertedId });
  } catch (err) {
    console.error('[notes] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /admin/notes/:id — update ────────────────────────────────────────────
router.put('/:id', express.json(), async (req, res) => {
  try {
    const { title, body, tags, clientId, tldr, tldrBullets } = req.body;
    const update = {
      title:    (title || '').trim() || 'Untitled Note',
      body:     body?.trim() || '',
      tags:     parseTags(tags),
      clientId: clientId ? new ObjectId(clientId) : null,
      updatedAt: new Date(),
    };
    if (tldr        !== undefined) update.tldr        = tldr;
    if (tldrBullets !== undefined) update.tldrBullets = tldrBullets;
    await req.db.collection('notes').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /admin/notes/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await req.db.collection('notes').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/notes/:id/tldr ───────────────────────────────────────────────
router.post('/:id/tldr', async (req, res) => {
  try {
    const db   = req.db;
    const note = await db.collection('notes').findOne({ _id: new ObjectId(req.params.id) });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const noteText = note.body;

    // These are personal notes written by and for the note-taker themselves.
    // Summaries must reflect that — first-person perspective, no coaching tone,
    // no "you should" or "the speaker mentions". Treat it like restating your own thoughts.
    const PERSONAL_NOTE_CONTEXT =
      'These are personal notes written by the user, for themselves. ' +
      'Summarise as if restating the writer\'s own thoughts back to them. ' +
      'Use first-person where natural ("I want to...", "The idea is...", "Need to..."). ' +
      'Never say "you", "the speaker", "the writer", or give advice. ' +
      'No preamble, no labels, no intro. Start with the first word of content.';

    const [rawParagraph, rawBullets, rawTags] = await Promise.all([
      // Paragraph form
      callLLM(
        [{ role: 'user', content: 'Note:\n' + noteText }],
        PERSONAL_NOTE_CONTEXT + ' Write 2-4 sentences of plain prose.'
      ),
      // Bullet form
      callLLM(
        [{ role: 'user', content: 'Note:\n' + noteText }],
        PERSONAL_NOTE_CONTEXT +
        ' Extract 3-6 key points as a plain bullet list. ' +
        'Each bullet starts with "- ". No nested bullets. No headers.'
      ),
      // Tags
      callLLM(
        [{ role: 'user', content: noteText }],
        'Output only a comma-separated list of 3-6 lowercase topic tags. No other text.'
      ),
    ]);

    function strip(t) {
      return t
        .trim()
        .replace(/^(here(?:'?s)?( a| the| is)?( summary| tldr)?|sure[,!]?|okay[,!]?|certainly[,!]?|of course[,!]?|tldr[ :_\-]+|summary[ :_\-]+|absolutely[,!]?)\s*/i, '')
        .replace(/^[*_]*(tldr|summary)[*_]*[:. ]+/i, '')
        .replace(/^[#*>\- ]+/, '')
        .trim();
    }

    const tldr        = strip(rawParagraph);
    const tldrBullets = rawBullets.trim();

    const suggestedTags = rawTags
      .split(',')
      .map(t => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
      .filter(Boolean)
      .slice(0, 6);

    await db.collection('notes').updateOne(
      { _id: note._id },
      { $set: { tldr, tldrBullets, suggestedTags, updatedAt: new Date() } },
    );
    res.json({ ok: true, tldr, tldrBullets, suggestedTags });
  } catch (err) {
    console.error('[notes] tldr error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/notes/:id/distribute ─────────────────────────────────────────
router.post('/:id/distribute', express.json(), async (req, res) => {
  try {
    const db     = req.db;
    const { targets } = req.body;
    if (!Array.isArray(targets) || !targets.length) return res.status(400).json({ error: 'targets required' });

    const note = await db.collection('notes').findOne({ _id: new ObjectId(req.params.id) });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const results = [];
    for (const target of targets) {
      try {
        const detail = await distributeNote(db, note, target, req);
        results.push({ target: target.section, ok: true, detail });
      } catch (e) {
        results.push({ target: target.section, ok: false, error: e.message });
      }
    }

    await db.collection('notes').updateOne(
      { _id: note._id },
      {
        $push: { distributed: { $each: results.map(r => ({ ...r, at: new Date() })) } },
        $set:  { updatedAt: new Date() },
      },
    );

    res.json({ ok: true, results });
  } catch (err) {
    console.error('[notes] distribute error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  DISTRIBUTE ENGINE
// ─────────────────────────────────────────────────────────────────────────────
async function distributeNote(db, note, target, req) {
  const brandName = req.tenant?.brand?.name || 'the business';
  const body      = note.body;
  const title     = note.title;
  const tldr      = note.tldr || body;
  const now       = new Date();

  switch (target.section) {

    case 'blog': {
      const raw = await callLLM([{ role: 'user', content:
        `Write a complete blog post for ${brandName} based on this note.\n`+
        `Return ONLY valid JSON (no markdown fences) with these exact fields:\n`+
        `{ "title": "...", "excerpt": "1-2 sentence summary", "content": "full HTML body with <p> and <h2> tags" }\n\n`+
        `Note to expand:\n${body}` }],
        'You are a professional content writer. Return only raw JSON, no markdown, no explanation.');

      let parsed;
      try {
        const clean = raw.replace(/```json|```/gi, '').trim();
        const m = clean.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m ? m[0] : clean);
      } catch {
        const lines   = raw.trim().split('\n').filter(Boolean);
        const rawTitle = lines[0].replace(/^#+\s*/,'').replace(/^\*+|\*+$/g,'').trim();
        parsed = { title: rawTitle || title, excerpt: tldr, content: lines.slice(1).join('\n').trim() };
      }

      const blogTitle = (parsed.title || title).trim();
      const slug = blogTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
                 + '-' + Date.now().toString(36);

      await db.collection('blog').insertOne({
        title: blogTitle, slug,
        excerpt:  (parsed.excerpt || tldr || '').trim(),
        content:  (parsed.content || parsed.body || '').trim(),
        category: target.category || '',
        tags:     note.tags || [],
        featuredImageUrl: '', status: 'draft', publishedAt: null,
        sourceNoteId: note._id, createdAt: now, updatedAt: now,
      });
      return `Blog draft "${blogTitle}" created — edit at /admin/blog`;
    }

    case 'email': {
      const raw = await callLLM([{ role: 'user', content:
        `Write a marketing email for ${brandName} based on this note.\n`+
        `Return ONLY valid JSON (no markdown fences):\n`+
        `{ "subject": "compelling subject line under 60 chars", "preheader": "preview text under 90 chars", "body": "full HTML email body" }\n\n`+
        `Note:\n${body}` }],
        'You are an email marketing expert. Return only raw JSON, no markdown, no explanation.');

      let parsed;
      try {
        const clean = raw.replace(/```json|```/gi, '').trim();
        const m = clean.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m ? m[0] : clean);
      } catch { parsed = { subject: title, preheader: '', body: raw.trim() }; }

      await db.collection('campaigns').insertOne({
        subject:     (parsed.subject || title).trim(),
        preheader:   (parsed.preheader || '').trim(),
        body:        (parsed.body || '').trim(),
        targetFunnel: target.targetFunnel || 'all',
        targetTags:  [], status: 'draft', sentCount: 0, sentAt: null,
        sourceNoteId: note._id, createdAt: now, updatedAt: now,
      });
      return `Email draft "${(parsed.subject || title).trim()}" created — edit at /admin/email-marketing`;
    }

    case 'campaign': {
      const raw = await callLLM([{ role: 'user', content:
        `Write social media posts for ${brandName} based on this note.\n`+
        `Return ONLY valid JSON (no markdown fences):\n`+
        `{ "instagram": "1-3 sentences + 5 hashtags on a new line", "facebook": "2-4 conversational sentences", "linkedin": "3-5 professional sentences" }\n\nNote:\n${tldr}` }],
        'You are a social media expert. Return only raw JSON, no markdown, no explanation.');

      let parsed;
      try {
        const clean = raw.replace(/```json|```/gi, '').trim();
        const m = clean.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m ? m[0] : clean);
      } catch { parsed = { instagram: raw.trim(), facebook: raw.trim(), linkedin: raw.trim() }; }

      await db.collection('social_presets').insertOne({
        name: `Note: ${title}`, description: tldr,
        captions: {
          instagram: (parsed.instagram || '').trim(),
          facebook:  (parsed.facebook  || '').trim(),
          linkedin:  (parsed.linkedin  || '').trim(),
        },
        tags: note.tags || [], sourceNoteId: note._id, createdAt: now, updatedAt: now,
      });
      return 'Social campaign (IG + FB + LinkedIn) saved to Social Generator presets';
    }

    case 'web': {
      const copyKey = (target.sectionKey || '').trim();
      if (!copyKey) throw new Error('Section / copy key is required');
      const tailored = await callLLM([{ role: 'user', content:
        `Rewrite this note as polished website copy for the "${copyKey}" section of ${brandName}.\n`+
        `Keep it concise, professional, and persuasive. Return only the copy text — no labels, no quotes:\n\n${body}` }],
        'You are a website copywriter. Return only the copy text, nothing else.');
      await db.collection('copy').updateOne(
        { key: copyKey },
        { $set: { key: copyKey, value: tailored.trim(), updatedAt: now } },
        { upsert: true },
      );
      return `Copy key "${copyKey}" updated — visible at /admin/copy`;
    }

    case 'client_note': {
      if (!target.clientId) throw new Error('Select a client first');
      const client = await db.collection('clients').findOne({ _id: new ObjectId(target.clientId) });
      if (!client) throw new Error('Client not found');
      await db.collection('clients').updateOne(
        { _id: client._id },
        { $push: { notes: {
            id: new ObjectId(), content: tldr, source: 'voice_note',
            noteId: note._id, createdBy: req.adminUser.email, createdAt: now,
          }},
          $set: { updatedAt: now },
        },
      );
      return `Note added to client "${client.name || client.email}"`;
    }

    case 'ticket': {
      await db.collection('tickets').insertOne({
        subject: title, body: tldr, status: 'open',
        priority: target.priority || 'medium', source: 'note',
        sourceNoteId: note._id, createdBy: req.adminUser.email,
        createdAt: now, updatedAt: now,
      });
      return 'Ticket created — view at /admin/tickets';
    }

    default:
      throw new Error(`Unknown target: ${target.section}`);
  }
}

function parseTags(raw) {
  if (!raw) return [];
  const arr = typeof raw === 'string' ? raw.split(',') : raw;
  return arr.map(t => t.trim().toLowerCase()).filter(Boolean);
}

export default router;
