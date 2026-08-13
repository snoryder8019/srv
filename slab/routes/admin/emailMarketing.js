import express from 'express';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import { getDb } from '../../plugins/mongo.js';
import { sendCampaignEmail, renderCampaignEmail } from '../../plugins/mailer.js';
import { config } from '../../config/config.js';
import { webSearch, callLLM, tryParseAgentResponse } from '../../plugins/agentMcp.js';
import { agentLLMOpts } from '../../plugins/agentRegistry.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import {
  resolveCampaignSchedule, scheduleCampaign, unscheduleCampaign, deliverCampaign,
} from '../../plugins/campaignSchedule.js';

const router = express.Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const FUNNELS = new Set(['lead', 'prospect', 'customer']);
const FORM_STYLES = new Set(['inline', 'footer', 'popup', 'hosted']);
function newFormToken() { return crypto.randomBytes(9).toString('base64url'); }
function parseTags(raw) { return (raw || '').split(',').map(t => t.trim()).filter(Boolean); }

// Normalized engagement numbers for a single campaign, from the pre-aggregated
// campaign_events map. Used to hang analytics off every card + follow-up row.
function campAnalytics(camp, analyticsMap) {
  const a = analyticsMap[camp._id.toString()] || {};
  const opens = a.open || { total: 0, unique: 0 };
  const clicks = a.click || { total: 0, unique: 0 };
  const sent = camp.sentCount || 0;
  return {
    sent,
    opensUnique: opens.unique, opensTotal: opens.total,
    clicksUnique: clicks.unique, clicksTotal: clicks.total,
    openRate: sent ? Math.round(opens.unique / sent * 100) : 0,
    clickRate: sent ? Math.round(clicks.unique / sent * 100) : 0,
  };
}

// ── Dashboard ──
router.get('/', async (req, res) => {
  const db = req.db;
  const tab = req.query.tab || 'contacts';

  const [contacts, campaigns, clients, campaignEvents, forms] = await Promise.all([
    db.collection('contacts').find({}).sort({ createdAt: -1 }).toArray(),
    db.collection('campaigns').find({}).sort({ createdAt: -1 }).toArray(),
    db.collection('clients').find({}).project({ name: 1, email: 1, status: 1 }).toArray(),
    db.collection('campaign_events').aggregate([
      { $group: { _id: { campaignId: '$campaignId', type: '$type' }, total: { $sum: 1 }, unique: { $addToSet: '$contactId' } } },
      { $project: { _id: 1, total: 1, unique: { $size: '$unique' } } },
    ]).toArray(),
    db.collection('signup_forms').find({}).sort({ createdAt: -1 }).toArray(),
  ]);

  // Build analytics lookup map
  const analyticsMap = {};
  for (const evt of campaignEvents) {
    const cid = evt._id.campaignId.toString();
    if (!analyticsMap[cid]) analyticsMap[cid] = {};
    analyticsMap[cid][evt._id.type] = { total: evt.total, unique: evt.unique };
  }

  // Stats
  const totalContacts = contacts.length;
  const subscribedContacts = contacts.filter(c => c.status === 'subscribed').length;
  const pendingContacts = contacts.filter(c => c.status === 'pending').length;
  const totalCampaigns = campaigns.length;
  const sentCampaigns = campaigns.filter(c => c.status === 'sent').length;

  // Funnel breakdown
  const funnelCounts = { lead: 0, prospect: 0, customer: 0, churned: 0 };
  for (const c of contacts) funnelCounts[c.funnel || 'lead']++;

  // ── Chart data ──────────────────────────────────────────────────────────
  // Status breakdown (donut)
  const statusCounts = { subscribed: 0, pending: 0, unsubscribed: 0, bounced: 0 };
  for (const c of contacts) {
    const s = c.status || 'subscribed';
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  }

  // List growth — daily new contacts over the last 30 days
  const DAY = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDay = new Date(today.getTime() - 29 * DAY);
  const buckets = new Map();
  for (let i = 0; i < 30; i++) {
    const d = new Date(startDay.getTime() + i * DAY);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const c of contacts) {
    if (!c.createdAt) continue;
    const k = new Date(c.createdAt).toISOString().slice(0, 10);
    if (buckets.has(k)) buckets.set(k, buckets.get(k) + 1);
  }
  const signupSeries = [...buckets.entries()].map(([date, count]) => ({ date, count }));
  const signups30 = signupSeries.reduce((a, b) => a + b.count, 0);

  // Source breakdown — where contacts came from (top sources)
  const sourceMap = {};
  for (const c of contacts) {
    const s = c.source || 'manual';
    sourceMap[s] = (sourceMap[s] || 0) + 1;
  }
  const sourceBreakdown = Object.entries(sourceMap).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([source, count]) => ({ source, count }));

  // Campaign engagement — per-campaign open/click rates + overall averages
  const sentList = campaigns.filter(c => c.status === 'sent');
  let sumOpen = 0, sumClick = 0, sumSent = 0;
  const campSeries = [];
  for (const camp of sentList) {
    const a = analyticsMap[camp._id.toString()] || {};
    const opens = a.open?.unique || 0;
    const clicks = a.click?.unique || 0;
    const n = camp.sentCount || 0;
    sumOpen += opens; sumClick += clicks; sumSent += n;
    campSeries.push({
      subject: camp.subject,
      openRate: n ? Math.round(opens / n * 100) : 0,
      clickRate: n ? Math.round(clicks / n * 100) : 0,
      sent: n,
    });
  }
  const engagement = {
    avgOpenRate: sumSent ? Math.round(sumOpen / sumSent * 100) : 0,
    avgClickRate: sumSent ? Math.round(sumClick / sumSent * 100) : 0,
    totalSent: sumSent,
    campSeries: campSeries.slice(0, 8),
  };

  // ── Campaign card tree: parents (original emails) with nested follow-ups ──
  // Parents render as side-by-side cards; each follow-up threads beneath its
  // parent with its own granular per-segment analytics. Pinned float to top;
  // archived are hidden behind a toggle. Orphaned follow-ups (parent deleted)
  // fall back to top-level so they never vanish.
  const showArchived = req.query.archived === '1';
  const byId = new Map(campaigns.map(c => [c._id.toString(), c]));
  for (const c of campaigns) c._analytics = campAnalytics(c, analyticsMap);

  const followUpsByParent = new Map();
  const parents = [];
  for (const c of campaigns) {
    const pid = c.parentCampaignId ? c.parentCampaignId.toString() : null;
    if (pid && byId.has(pid)) {
      if (!followUpsByParent.has(pid)) followUpsByParent.set(pid, []);
      followUpsByParent.get(pid).push(c);
    } else {
      parents.push(c);
    }
  }
  for (const p of parents) {
    p._followUps = (followUpsByParent.get(p._id.toString()) || [])
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  const archivedCount = parents.filter(p => p.archived).length;
  const campaignTree = parents
    .filter(p => (showArchived ? p.archived : !p.archived))
    .sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return new Date(b.sentAt || b.createdAt) - new Date(a.sentAt || a.createdAt);
    });
  const templates = campaigns.filter(c => c.isTemplate);

  res.render('admin/email-marketing/index', {
    user: req.adminUser,
    tab,
    contacts,
    campaigns,
    campaignTree,
    templates,
    archivedCount,
    showArchived,
    clients,
    forms,
    analyticsMap,
    tenantDomain: req.tenant?.domain ? `https://${req.tenant.domain}` : '',
    stats: { totalContacts, subscribedContacts, pendingContacts, totalCampaigns, sentCampaigns },
    funnelCounts,
    charts: { statusCounts, signupSeries, signups30, sourceBreakdown, engagement },
    qs: req.query,
  });
});

// ── Add single contact ──
router.post('/contacts', async (req, res) => {
  try {
    const db = req.db;
    const { email, name, funnel, source, tags } = req.body;
    if (!email) return res.redirect('/admin/email-marketing?tab=contacts&error=Email+required');

    const existing = await db.collection('contacts').findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.redirect('/admin/email-marketing?tab=contacts&error=Contact+already+exists');

    await db.collection('contacts').insertOne({
      email: email.toLowerCase().trim(),
      name: name || '',
      funnel: funnel || 'lead',
      source: source || 'manual',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      status: 'subscribed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.redirect('/admin/email-marketing?tab=contacts&success=Contact+added');
  } catch (err) {
    console.error('Add contact error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=Failed+to+add+contact');
  }
});

// ── CSV upload ──
router.post('/contacts/upload', csvUpload.single('csv'), async (req, res) => {
  try {
    const db = req.db;
    if (!req.file) return res.redirect('/admin/email-marketing?tab=contacts&error=No+file+uploaded');

    const text = req.file.buffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.redirect('/admin/email-marketing?tab=contacts&error=CSV+is+empty');

    // Parse header
    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
    const emailIdx = header.findIndex(h => h === 'email' || h === 'e-mail' || h === 'email address');
    const nameIdx = header.findIndex(h => h === 'name' || h === 'full name' || h === 'fullname');
    const tagsIdx = header.findIndex(h => h === 'tags' || h === 'tag');

    if (emailIdx === -1) return res.redirect('/admin/email-marketing?tab=contacts&error=CSV+must+have+an+email+column');

    const funnel = req.body.funnel || 'lead';
    const source = req.body.source || 'csv-upload';
    let imported = 0, skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      const email = cols[emailIdx]?.toLowerCase().trim();
      if (!email || !email.includes('@')) { skipped++; continue; }

      const existing = await db.collection('contacts').findOne({ email });
      if (existing) { skipped++; continue; }

      await db.collection('contacts').insertOne({
        email,
        name: nameIdx >= 0 ? (cols[nameIdx] || '') : '',
        funnel,
        source,
        tags: tagsIdx >= 0 && cols[tagsIdx] ? cols[tagsIdx].split(';').map(t => t.trim()).filter(Boolean) : [],
        status: 'subscribed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    }

    console.log(`[Email Marketing] CSV import: ${imported} added, ${skipped} skipped`);
    res.redirect(`/admin/email-marketing?tab=contacts&success=Imported+${imported}+contacts+(${skipped}+skipped)`);
  } catch (err) {
    console.error('CSV upload error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=CSV+import+failed');
  }
});

// ── Import clients as contacts ──
router.post('/contacts/import-clients', async (req, res) => {
  try {
    const db = req.db;
    const clients = await db.collection('clients').find({ email: { $exists: true, $ne: '' } }).toArray();
    let imported = 0, skipped = 0;

    for (const cl of clients) {
      const email = cl.email.toLowerCase().trim();
      const existing = await db.collection('contacts').findOne({ email });
      if (existing) { skipped++; continue; }

      await db.collection('contacts').insertOne({
        email,
        name: cl.name || '',
        funnel: cl.status === 'active' ? 'customer' : 'prospect',
        source: 'client-import',
        tags: ['client'],
        status: 'subscribed',
        clientId: cl._id.toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    }

    console.log(`[Email Marketing] Client import: ${imported} added, ${skipped} skipped`);
    res.redirect(`/admin/email-marketing?tab=contacts&success=Imported+${imported}+clients+(${skipped}+already+exist)`);
  } catch (err) {
    console.error('Client import error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=Client+import+failed');
  }
});

// ── Update contact funnel/status ──
router.post('/contacts/:id/update', async (req, res) => {
  try {
    const db = req.db;
    const update = {};
    if (req.body.funnel) update.funnel = req.body.funnel;
    if (req.body.status) update.status = req.body.status;
    if (req.body.tags !== undefined) update.tags = req.body.tags.split(',').map(t => t.trim()).filter(Boolean);
    update.updatedAt = new Date();

    await db.collection('contacts').updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
    res.redirect('/admin/email-marketing?tab=contacts&success=Contact+updated');
  } catch (err) {
    console.error('Contact update error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=Update+failed');
  }
});

// ── Delete contact ──
router.post('/contacts/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('contacts').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/email-marketing?tab=contacts&success=Contact+removed');
});

// ═══════════════ SIGNUP FORMS (lead capture) ═══════════════

// ── Create signup form ──
router.post('/forms', async (req, res) => {
  try {
    const db = req.db;
    const { name, headline, subhead, buttonText, successMessage, funnel, tags, style,
            collectName, optIn, welcomeSubject, welcomeBody } = req.body;
    if (!name) return res.redirect('/admin/email-marketing?tab=forms&error=Form+name+required');

    await db.collection('signup_forms').insertOne({
      name: name.trim(),
      token: newFormToken(),
      headline: headline?.trim() || 'Join our newsletter',
      subhead: subhead?.trim() || '',
      buttonText: buttonText?.trim() || 'Subscribe',
      successMessage: successMessage?.trim() || '',
      funnel: FUNNELS.has(funnel) ? funnel : 'lead',
      tags: parseTags(tags).length ? parseTags(tags) : ['newsletter'],
      source: `form:${(name || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`,
      style: FORM_STYLES.has(style) ? style : 'inline',
      collectName: collectName === 'on' || collectName === 'true',
      optIn: optIn === 'single' ? 'single' : 'double',
      welcomeSubject: welcomeSubject?.trim() || '',
      welcomeBody: welcomeBody?.trim() || '',
      enabled: true,
      signupCount: 0,
      confirmedCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    res.redirect('/admin/email-marketing?tab=forms&success=Form+created');
  } catch (err) {
    console.error('Create form error:', err);
    res.redirect('/admin/email-marketing?tab=forms&error=Failed+to+create+form');
  }
});

// ── Update signup form ──
router.post('/forms/:id/update', async (req, res) => {
  try {
    const db = req.db;
    const b = req.body;
    const set = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name.trim();
    if (b.headline !== undefined) set.headline = b.headline.trim();
    if (b.subhead !== undefined) set.subhead = b.subhead.trim();
    if (b.buttonText !== undefined) set.buttonText = b.buttonText.trim() || 'Subscribe';
    if (b.successMessage !== undefined) set.successMessage = b.successMessage.trim();
    if (b.funnel !== undefined && FUNNELS.has(b.funnel)) set.funnel = b.funnel;
    if (b.tags !== undefined) set.tags = parseTags(b.tags).length ? parseTags(b.tags) : ['newsletter'];
    if (b.style !== undefined && FORM_STYLES.has(b.style)) set.style = b.style;
    if (b.optIn !== undefined) set.optIn = b.optIn === 'single' ? 'single' : 'double';
    if (b.welcomeSubject !== undefined) set.welcomeSubject = b.welcomeSubject.trim();
    if (b.welcomeBody !== undefined) set.welcomeBody = b.welcomeBody.trim();
    set.collectName = b.collectName === 'on' || b.collectName === 'true';
    if (b.enabled !== undefined) set.enabled = b.enabled === 'on' || b.enabled === 'true';

    await db.collection('signup_forms').updateOne({ _id: new ObjectId(req.params.id) }, { $set: set });
    res.redirect('/admin/email-marketing?tab=forms&success=Form+updated');
  } catch (err) {
    console.error('Update form error:', err);
    res.redirect('/admin/email-marketing?tab=forms&error=Update+failed');
  }
});

// ── Toggle enabled (quick switch) ──
router.post('/forms/:id/toggle', async (req, res) => {
  try {
    const db = req.db;
    const form = await db.collection('signup_forms').findOne({ _id: new ObjectId(req.params.id) });
    if (form) {
      await db.collection('signup_forms').updateOne(
        { _id: form._id },
        { $set: { enabled: !form.enabled, updatedAt: new Date() } }
      );
    }
    res.redirect('/admin/email-marketing?tab=forms&success=Form+updated');
  } catch (err) {
    res.redirect('/admin/email-marketing?tab=forms&error=Toggle+failed');
  }
});

// ── Delete signup form ──
router.post('/forms/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('signup_forms').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/email-marketing?tab=forms&success=Form+deleted');
});

// ── Form copy AI generator ──
// Writes headline, subhead, button, success message, and a welcome autoresponder
// body from the brand context + the admin's brief. Returns { message, fill }.
router.post('/forms/agent', async (req, res) => {
  const { prompt } = req.body;
  try {
    const db = req.db;
    const design = await db.collection('design').findOne({});
    const agentName = design?.agent_name || req.tenant?.brand?.name || 'this business';
    const brandCtx = await loadBrandContext(req.tenant, req.db);

    const systemPrompt = `You write high-converting email signup form copy for ${agentName}.

${brandCtx}

Your ONLY job is to output a JSON object. No prose, no markdown fences. Just raw JSON of exactly this shape:
{
  "message": "one short sentence describing the form you wrote",
  "fill": {
    "headline": "short punchy form headline (under 50 chars)",
    "subhead": "one-line value proposition for subscribing (under 120 chars)",
    "buttonText": "2-3 word button label",
    "successMessage": "friendly confirmation shown after they submit (under 120 chars)",
    "welcomeSubject": "subject line for the welcome email (under 60 chars)",
    "welcomeBody": "full HTML welcome email body as a single escaped string"
  }
}

Rules for welcomeBody:
- Warm, on-brand welcome for a NEW subscriber. Use <h2>, <p>, <strong>, <a> tags.
- Use {name} for personalization. Include one clear call-to-action button.
- 120-250 words. Escape all double quotes as \\" and use \\n for newlines.
- Match the brand voice above. Make people glad they signed up.

The admin's brief: "${(prompt || 'a general newsletter signup form').slice(0, 400)}"`;

    const raw = await callLLM([{ role: 'user', content: prompt || 'Write newsletter signup form copy.' }], systemPrompt, 90000, await agentLLMOpts(req.db, req.tenant, 'email'));
    const parsed = tryParseAgentResponse(raw);
    res.json(parsed);
  } catch (err) {
    console.error('Form agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Create campaign ──
router.post('/campaigns', async (req, res) => {
  try {
    const db = req.db;
    const { subject, preheader, body, targetFunnel, targetTags } = req.body;
    if (!subject || !body) return res.redirect('/admin/email-marketing?tab=campaigns&error=Subject+and+body+required');

    // An empty schedule field just means "draft" — same rule on create and update.
    let sched;
    try { sched = resolveCampaignSchedule(req.body); }
    catch (err) { return res.redirect('/admin/email-marketing?tab=campaigns&error=' + encodeURIComponent(err.message)); }

    await db.collection('campaigns').insertOne({
      subject,
      preheader: preheader || '',
      body,
      targetFunnel: targetFunnel || 'all',
      targetTags: targetTags ? targetTags.split(',').map(t => t.trim()).filter(Boolean) : [],
      status: sched.status,
      scheduledAt: sched.scheduledAt,
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.redirect('/admin/email-marketing?tab=campaigns&success='
      + (sched.scheduledAt ? encodeURIComponent(`Scheduled for ${sched.scheduledAt.toLocaleString()}`) : 'Campaign+created'));
  } catch (err) {
    console.error('Create campaign error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Failed+to+create+campaign');
  }
});

// ── Update campaign draft (edit copy before sending) ──
router.post('/campaigns/:id/update', async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');
    if (campaign.status === 'sent') return res.redirect('/admin/email-marketing?tab=campaigns&error=Sent+campaigns+cannot+be+edited');
    if (campaign.status === 'sending') return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+is+sending+right+now');

    const { subject, preheader, body, targetFunnel, targetTags } = req.body;
    if (!subject || !body) return res.redirect('/admin/email-marketing?tab=campaigns&error=Subject+and+body+required');

    // The schedule field is authoritative on every save: a date puts the
    // campaign on the calendar, a cleared date takes it back off.
    let sched;
    try { sched = resolveCampaignSchedule(req.body); }
    catch (err) { return res.redirect('/admin/email-marketing?tab=campaigns&error=' + encodeURIComponent(err.message)); }

    const set = {
      subject,
      preheader: preheader || '',
      body,
      status: sched.status,
      scheduledAt: sched.scheduledAt,
      sendError: null,
      updatedAt: new Date(),
    };
    // Follow-up campaigns target explicit contact IDs — don't clobber their segment targeting.
    if (!campaign.targetContactIds?.length) {
      set.targetFunnel = targetFunnel || 'all';
      set.targetTags = targetTags ? targetTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    }

    await db.collection('campaigns').updateOne({ _id: campaign._id }, { $set: set });
    res.redirect('/admin/email-marketing?tab=campaigns&success='
      + (sched.scheduledAt ? encodeURIComponent(`Scheduled for ${sched.scheduledAt.toLocaleString()}`) : 'Campaign+updated'));
  } catch (err) {
    console.error('Update campaign error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Failed+to+update+campaign');
  }
});

// ── Marketing Agent (must be before :id routes) ──
router.post('/campaigns/agent', async (req, res) => {
  const { messages, currentCampaign } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    const db = req.db;
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Gather business context
    const [contactCount, design] = await Promise.all([
      db.collection('contacts').countDocuments({ status: 'subscribed' }),
      db.collection('design').findOne({}),
    ]);
    const agentName = design?.agent_name || 'the brand';

    const searchResults = await webSearch(lastUserMsg.slice(0, 200));

    let campaignCtx = '';
    if (currentCampaign?.parentSubject) {
      campaignCtx = `\n\nThis is a FOLLOW-UP to a previously sent campaign with subject: "${currentCampaign.parentSubject}".`
        + `\nTarget segment: ${currentCampaign.segment || 'all'}.`
        + (currentCampaign.subject ? `\nCurrent draft subject: "${currentCampaign.subject}"` : '')
        + `\nWrite a follow-up that references or builds on the original campaign. Adjust tone based on the segment (e.g. re-engage unopened, reward clickers, nudge openers).`;
    } else if (currentCampaign?.subject) {
      campaignCtx = `\n\nExisting campaign draft — subject: "${currentCampaign.subject}", target: "${currentCampaign.targetFunnel || 'all'}"`;
    }

    const researchCtx = searchResults && !searchResults.startsWith('Search')
      ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---`
      : '';

    const brandCtx = await loadBrandContext(req.tenant, req.db);

    const systemPrompt = `You are a marketing email writing assistant for ${agentName}.

${brandCtx}

You have ${contactCount} subscribed contacts.

Your ONLY job is to output a JSON object. No prose before or after it. No markdown code fences. Just the raw JSON.

The JSON must have exactly this shape:
{
  "message": "one short sentence describing what you wrote",
  "fill": {
    "subject": "compelling email subject line (under 60 chars)",
    "preheader": "preview text shown in inbox (under 100 chars)",
    "body": "full HTML email body as a single escaped string"
  }
}

Rules for the body field:
- Write engaging marketing email HTML using <h2>, <p>, <strong>, <ul>, <li>, <a> tags
- Use {name} for personalization (recipient's name) and {email} for their email
- Include a clear call-to-action with a styled button
- Keep total length 150-400 words
- All double quotes inside the HTML must be escaped as \\"
- No literal newlines inside the JSON string — use \\n instead
- Tone: match the brand voice described above, professional but warm, not spammy

Tailor content to the business and audience described above.
${campaignCtx}${researchCtx}`;

    const raw = await callLLM(messages, systemPrompt, 90000, await agentLLMOpts(req.db, req.tenant, 'email'));
    console.log('[email-agent] raw LLM response length:', raw.length);

    const parsed = tryParseAgentResponse(raw);
    console.log('[email-agent] fill keys:', Object.keys(parsed.fill || {}));

    res.json(parsed);
  } catch (err) {
    console.error('Email marketing agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Live campaign preview (composer — unsaved draft) ──
// Renders the real branded campaign template from the in-progress form fields
// so the admin sees exactly what a subscriber receives before saving/sending.
router.post('/campaigns/preview', express.json(), async (req, res) => {
  try {
    const { subject, preheader, body } = req.body;
    const { html } = await renderCampaignEmail({
      toEmail: req.adminUser?.email || 'subscriber@example.com',
      toName: 'there',
      subject: subject || '(no subject)',
      preheader: preheader || '',
      brandDomain: req.tenant?.domain ? `https://${req.tenant.domain}` : '',
      body: body || '<p style="color:#888;">Your email body will appear here…</p>',
      tenant: req.tenant,
    });
    res.json({ html, subject: subject || '(no subject)' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Preview failed' });
  }
});

// ── Saved campaign preview (draft/sent row) ──
router.post('/campaigns/:id/preview', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const { html } = await renderCampaignEmail({
      toEmail: req.adminUser?.email || 'subscriber@example.com',
      toName: 'there',
      subject: campaign.subject || '(no subject)',
      preheader: campaign.preheader || '',
      brandDomain: req.tenant?.domain ? `https://${req.tenant.domain}` : '',
      body: campaign.body || '',
      tenant: req.tenant,
    });
    res.json({ html, subject: campaign.subject || '(no subject)' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Preview failed' });
  }
});

// ── Send campaign ──
// Sends immediately, through the same claim-and-deliver core the scheduler uses,
// so a manual send and a due scheduled send can never both go out.
router.post('/campaigns/:id/send', async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');
    if (campaign.status === 'sent') return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+already+sent');

    const out = await deliverCampaign(db, campaign, req.tenant);
    if (!out.ok) {
      return res.redirect(`/admin/email-marketing?tab=campaigns&error=${encodeURIComponent(out.error || 'Send failed')}`);
    }

    console.log(`[Email Marketing] Campaign "${campaign.subject}" sent to ${out.sent} contacts (${out.failed} failed)`);
    res.redirect(`/admin/email-marketing?tab=campaigns&success=Sent+to+${out.sent}+contacts`);
  } catch (err) {
    console.error('Send campaign error:', err);
    res.redirect(`/admin/email-marketing?tab=campaigns&error=${encodeURIComponent(err.message || 'Send failed')}`);
  }
});

// ── Schedule / unschedule (the calendar path for campaigns) ──
// Mirrors the blog + social scheduling contract: a POST with a date puts it on
// the calendar, a POST to /unschedule pulls it back to draft. Both bounce to
// wherever the admin was, so the campaign cards and the platform calendar chips
// can drive the same endpoints.
router.post('/campaigns/:id/schedule', async (req, res) => {
  try {
    const at = req.body.scheduledAt || (req.body.date ? `${req.body.date}T${req.body.time || '09:00'}` : '');
    if (!at) return res.redirect(backTo(req).split('?')[0] + '?tab=campaigns&error=Pick+a+send+date+and+time');
    const when = await scheduleCampaign(req.db, req.params.id, new Date(at));
    if (req.xhr) return res.json({ ok: true, scheduledAt: when.toISOString() });
    res.redirect(`/admin/email-marketing?tab=campaigns&success=${encodeURIComponent(`Scheduled for ${when.toLocaleString()}`)}`);
  } catch (err) {
    console.error('[email] schedule error:', err.message);
    if (req.xhr) return res.status(err.status || 500).json({ ok: false, error: err.message });
    res.redirect(`/admin/email-marketing?tab=campaigns&error=${encodeURIComponent(err.message || 'Schedule failed')}`);
  }
});

router.post('/campaigns/:id/unschedule', async (req, res) => {
  try {
    await unscheduleCampaign(req.db, req.params.id);
    if (req.xhr) return res.json({ ok: true });
    res.redirect('/admin/email-marketing?tab=campaigns&success=Back+to+draft');
  } catch (err) {
    console.error('[email] unschedule error:', err.message);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Unschedule+failed');
  }
});

// ── Send a test copy of a campaign to a single address ──
// No tracking, no status change, no counts — just renders & delivers one email
// so the admin can proof it. Defaults to the logged-in admin's own inbox.
router.post('/campaigns/:id/test', async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');

    const testEmail = (req.body.testEmail || req.adminUser?.email || '').toLowerCase().trim();
    if (!testEmail || !testEmail.includes('@')) {
      return res.redirect('/admin/email-marketing?tab=campaigns&error=Valid+test+email+required');
    }

    // Omit campaignId/contactId so no tracking pixel/link rewrite and no events logged.
    await sendCampaignEmail(testEmail, req.adminUser?.name || 'there', campaign.subject, campaign.preheader, campaign.body, null, null, req.tenant);

    console.log(`[Email Marketing] TEST of "${campaign.subject}" sent to ${testEmail}`);
    res.redirect(`/admin/email-marketing?tab=campaigns&success=${encodeURIComponent('Test sent to ' + testEmail)}`);
  } catch (err) {
    console.error('Test send error:', err);
    res.redirect(`/admin/email-marketing?tab=campaigns&error=${encodeURIComponent(err.message || 'Test send failed')}`);
  }
});

// ── Card state toggles (pin / archive / save-as-template) ──
// These flip a boolean and bounce back to wherever the admin was (referer),
// so the archived-view toggle state is preserved without extra plumbing.
function backTo(req) { return req.get('referer') || '/admin/email-marketing?tab=campaigns'; }

router.post('/campaigns/:id/pin', async (req, res) => {
  try {
    const db = req.db;
    const camp = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (camp) await db.collection('campaigns').updateOne({ _id: camp._id }, { $set: { pinned: !camp.pinned, updatedAt: new Date() } });
    res.redirect(backTo(req));
  } catch (err) {
    console.error('Pin toggle error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Pin+failed');
  }
});

router.post('/campaigns/:id/archive', async (req, res) => {
  try {
    const db = req.db;
    const camp = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    // Archiving a card also unpins it — a hidden card shouldn't hold a top slot.
    if (camp) await db.collection('campaigns').updateOne(
      { _id: camp._id },
      { $set: { archived: !camp.archived, ...(camp.archived ? {} : { pinned: false }), updatedAt: new Date() } }
    );
    res.redirect(backTo(req));
  } catch (err) {
    console.error('Archive toggle error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Archive+failed');
  }
});

router.post('/campaigns/:id/template', async (req, res) => {
  try {
    const db = req.db;
    const camp = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (camp) await db.collection('campaigns').updateOne({ _id: camp._id }, { $set: { isTemplate: !camp.isTemplate, updatedAt: new Date() } });
    res.redirect(backTo(req));
  } catch (err) {
    console.error('Template toggle error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Save+failed');
  }
});

// Clone any campaign/template into a fresh, standalone draft the admin can edit.
router.post('/campaigns/:id/clone', async (req, res) => {
  try {
    const db = req.db;
    const camp = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!camp) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');
    await db.collection('campaigns').insertOne({
      subject: `Copy of ${camp.subject || 'Untitled'}`.slice(0, 200),
      preheader: camp.preheader || '',
      body: camp.body || '',
      targetFunnel: camp.parentCampaignId ? 'all' : (camp.targetFunnel || 'all'),
      targetTags: camp.parentCampaignId ? [] : (camp.targetTags || []),
      status: 'draft',
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    res.redirect('/admin/email-marketing?tab=campaigns&success=Copied+to+a+new+draft');
  } catch (err) {
    console.error('Clone error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Copy+failed');
  }
});

// ── Campaign detail page (analytics + follow-up) ──
router.get('/campaigns/:id', async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');

    // Get all events for this campaign
    const events = await db.collection('campaign_events')
      .find({ campaignId: campaign._id })
      .sort({ createdAt: -1 })
      .toArray();

    // Get all contacts that were targeted
    const contactFilter = { status: { $in: ['subscribed', 'unsubscribed', 'bounced'] } };
    if (campaign.targetFunnel && campaign.targetFunnel !== 'all') contactFilter.funnel = campaign.targetFunnel;
    if (campaign.targetTags?.length) contactFilter.tags = { $in: campaign.targetTags };
    const contacts = await db.collection('contacts').find(contactFilter).toArray();

    // Build per-contact engagement map
    const contactEngagement = {};
    for (const c of contacts) {
      contactEngagement[c._id.toString()] = { contact: c, opened: false, clicked: false, openCount: 0, clickCount: 0, clicks: [] };
    }
    for (const evt of events) {
      const rid = evt.contactId.toString();
      if (!contactEngagement[rid]) continue;
      if (evt.type === 'open') {
        contactEngagement[rid].opened = true;
        contactEngagement[rid].openCount++;
      }
      if (evt.type === 'click') {
        contactEngagement[rid].clicked = true;
        contactEngagement[rid].clickCount++;
        if (evt.url) contactEngagement[rid].clicks.push(evt.url);
      }
    }

    // Segment counts
    const segments = {
      all: contacts.length,
      opened: Object.values(contactEngagement).filter(e => e.opened).length,
      unopened: Object.values(contactEngagement).filter(e => !e.opened).length,
      clicked: Object.values(contactEngagement).filter(e => e.clicked).length,
      openedNotClicked: Object.values(contactEngagement).filter(e => e.opened && !e.clicked).length,
    };

    // Top clicked URLs
    const urlCounts = {};
    for (const evt of events) {
      if (evt.type === 'click' && evt.url) urlCounts[evt.url] = (urlCounts[evt.url] || 0) + 1;
    }
    const topUrls = Object.entries(urlCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Get list of other campaigns for "copy" feature
    const otherCampaigns = await db.collection('campaigns')
      .find({ _id: { $ne: campaign._id }, status: 'sent' })
      .sort({ sentAt: -1 }).limit(10)
      .project({ subject: 1, sentAt: 1 }).toArray();

    res.render('admin/email-marketing/detail', {
      user: req.adminUser,
      campaign,
      events,
      contactEngagement,
      segments,
      topUrls,
      otherCampaigns,
      qs: req.query,
    });
  } catch (err) {
    console.error('Campaign detail error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Failed+to+load+campaign');
  }
});

// ── Create follow-up campaign based on engagement ──
router.post('/campaigns/:id/follow-up', async (req, res) => {
  try {
    const db = req.db;
    const parentCampaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!parentCampaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');

    const { segment, subject, preheader, body } = req.body;
    if (!subject || !body) return res.redirect(`/admin/email-marketing/campaigns/${req.params.id}?error=Subject+and+body+required`);

    // Get events for the parent campaign to determine who opened/clicked
    const events = await db.collection('campaign_events').find({ campaignId: parentCampaign._id }).toArray();
    const openedIds = new Set();
    const clickedIds = new Set();
    for (const evt of events) {
      if (evt.type === 'open') openedIds.add(evt.contactId.toString());
      if (evt.type === 'click') clickedIds.add(evt.contactId.toString());
    }

    // Get the original contact pool
    const contactFilter = { status: 'subscribed' };
    if (parentCampaign.targetFunnel && parentCampaign.targetFunnel !== 'all') contactFilter.funnel = parentCampaign.targetFunnel;
    if (parentCampaign.targetTags?.length) contactFilter.tags = { $in: parentCampaign.targetTags };
    const allContacts = await db.collection('contacts').find(contactFilter).toArray();

    // Filter by segment
    let targetContactIds;
    if (segment === 'unopened') {
      targetContactIds = allContacts.filter(c => !openedIds.has(c._id.toString())).map(c => c._id);
    } else if (segment === 'opened') {
      targetContactIds = allContacts.filter(c => openedIds.has(c._id.toString())).map(c => c._id);
    } else if (segment === 'clicked') {
      targetContactIds = allContacts.filter(c => clickedIds.has(c._id.toString())).map(c => c._id);
    } else if (segment === 'opened_not_clicked') {
      targetContactIds = allContacts.filter(c => openedIds.has(c._id.toString()) && !clickedIds.has(c._id.toString())).map(c => c._id);
    } else {
      targetContactIds = allContacts.map(c => c._id);
    }

    if (!targetContactIds.length) {
      return res.redirect(`/admin/email-marketing/campaigns/${req.params.id}?error=No+contacts+in+this+segment`);
    }

    // Create the follow-up campaign with explicit contact IDs
    const result = await db.collection('campaigns').insertOne({
      subject,
      preheader: preheader || '',
      body,
      targetFunnel: 'segment',
      targetTags: [],
      targetContactIds,
      parentCampaignId: parentCampaign._id,
      parentSegment: segment,
      status: 'draft',
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`[Email Marketing] Follow-up created for "${parentCampaign.subject}" → segment: ${segment}, ${targetContactIds.length} contacts`);
    res.redirect(`/admin/email-marketing?tab=campaigns&success=Follow-up+created+(${targetContactIds.length}+contacts)`);
  } catch (err) {
    console.error('Follow-up error:', err);
    res.redirect(`/admin/email-marketing/campaigns/${req.params.id}?error=${encodeURIComponent(err.message || 'Failed')}`);
  }
});

// ── Delete campaign ──
router.post('/campaigns/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('campaigns').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/email-marketing?tab=campaigns&success=Campaign+deleted');
});

export default router;
