import express from 'express';
import { getDb } from '../../plugins/mongo.js';
import { sectionUpload } from '../../middleware/upload.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET } from '../../plugins/s3.js';
import { ObjectId } from 'mongodb';
import { config } from '../../config/config.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { callLLM, tryParseAgentResponse } from '../../plugins/agentMcp.js';

const router = express.Router();

// ── HARDCODED SECTION META ──────────────────────────────────────────────────
export const SECTIONS_META = {
  hero: {
    label: 'Hero', icon: '◈',
    desc: 'Main landing banner — headline, subtext, and hero imagery',
    copyKeys: ['hero_eyebrow','hero_heading','hero_heading_em','hero_sub','hero_badge'],
    images: [{ key: 'hero_image', label: 'Hero Background / Right Panel Image' }],
  },
  services: {
    label: 'Services', icon: '⊞',
    desc: 'Three service offerings with titles and descriptions',
    copyKeys: ['services_label','services_heading','services_heading_em','services_sub',
      'service1_title','service1_desc','service2_title','service2_desc','service3_title','service3_desc'],
    images: [
      { key: 'service1_image', label: 'Service 1 Image' },
      { key: 'service2_image', label: 'Service 2 Image' },
      { key: 'service3_image', label: 'Service 3 Image' },
    ],
  },
  about: {
    label: 'About', icon: '◉',
    desc: 'Team/advisor section with quote, description, and photo',
    copyKeys: ['about_quote','about_desc','about_sig'],
    images: [{ key: 'about_image', label: 'About / Team Photo' }],
  },
  process: {
    label: 'Process', icon: '⟳',
    desc: 'Step-by-step how it works section',
    copyKeys: ['process_label','process_heading','process_heading_em',
      'process1_title','process1_desc','process2_title','process2_desc',
      'process3_title','process3_desc','process4_title','process4_desc'],
    images: [{ key: 'process_image', label: 'Process Section Image (optional)' }],
  },
  contact: {
    label: 'Contact', icon: '✉',
    desc: 'Contact form section with location details',
    copyKeys: ['contact_sub','contact_location','contact_serving','contact_services'],
    images: [{ key: 'contact_image', label: 'Contact Section Image (optional)' }],
  },
};

const COPY_LABELS = {
  hero_eyebrow:'Eyebrow Line', hero_heading:'Heading', hero_heading_em:'Heading Italic',
  hero_sub:'Subtext', hero_badge:'Badge Text',
  services_label:'Section Label', services_heading:'Section Heading',
  services_heading_em:'Heading Italic', services_sub:'Section Subtext',
  service1_title:'Service 1 Title', service1_desc:'Service 1 Description',
  service2_title:'Service 2 Title', service2_desc:'Service 2 Description',
  service3_title:'Service 3 Title', service3_desc:'Service 3 Description',
  about_quote:'Pull Quote', about_desc:'Description', about_sig:'Signature',
  process_label:'Section Label', process_heading:'Heading', process_heading_em:'Heading Italic',
  process1_title:'Step 1 Title', process1_desc:'Step 1 Description',
  process2_title:'Step 2 Title', process2_desc:'Step 2 Description',
  process3_title:'Step 3 Title', process3_desc:'Step 3 Description',
  process4_title:'Step 4 Title', process4_desc:'Step 4 Description',
  contact_sub:'Contact Subtext', contact_location:'Location', contact_serving:'Serving Area',
  contact_services:'Services List',
};

const COPY_DEFAULTS = {
  hero_eyebrow:'Welcome', hero_heading:'Grow your brand', hero_heading_em:'online.',
  hero_sub:'Professional services tailored to your business needs.',
  hero_badge:'',
  services_label:'What We Do', services_heading:'Our', services_heading_em:'Services',
  services_sub:'Everything your business needs to build a powerful presence.',
  service1_title:'Service One', service1_desc:'Description of your first service offering.',
  service2_title:'Service Two', service2_desc:'Description of your second service offering.',
  service3_title:'Service Three', service3_desc:'Description of your third service offering.',
  about_quote:'', about_desc:'', about_sig:'',
  process_label:'How It Works', process_heading:'Simple', process_heading_em:'Process',
  process1_title:'Discovery', process1_desc:'We learn your goals, audience, and vision.',
  process2_title:'Strategy', process2_desc:'We build a custom plan tailored to your needs.',
  process3_title:'Create', process3_desc:'We produce and review deliverables with you.',
  process4_title:'Launch & Grow', process4_desc:'We go live, track results, and optimize.',
  contact_sub:"Ready to get started? Tell us about your project and we'll be in touch.",
  contact_location:'', contact_serving:'', contact_services:'',
};

const DESIGN_DEFAULTS = {
  vis_hero:'true', vis_services:'true', vis_portfolio:'true',
  vis_about:'true', vis_process:'true', vis_reviews:'true',
  vis_contact:'true', vis_blog:'false',
};

// ── CUSTOM SECTION TEMPLATES ────────────────────────────────────────────────
export const CUSTOM_TEMPLATES = {
  text: {
    label: 'Text Section', icon: '¶',
    desc: 'Heading with rich HTML body content',
    fields: [
      { key: 'heading',    label: 'Heading',     type: 'text' },
      { key: 'subheading', label: 'Subheading',  type: 'text' },
      { key: 'body',       label: 'Body Content', type: 'textarea' },
    ],
    images: [],
  },
  split: {
    label: 'Split Section', icon: '⊟',
    desc: 'Text on one side, image on the other',
    fields: [
      { key: 'heading',  label: 'Heading',     type: 'text' },
      { key: 'body',     label: 'Body Text',   type: 'textarea' },
      { key: 'cta_text', label: 'Button Text', type: 'text' },
      { key: 'cta_link', label: 'Button Link', type: 'text' },
    ],
    images: [{ key: 'main_image', label: 'Section Image' }],
  },
  cta: {
    label: 'CTA Banner', icon: '→',
    desc: 'Bold call-to-action banner with button',
    fields: [
      { key: 'heading',  label: 'Headline',    type: 'text' },
      { key: 'subtext',  label: 'Subtext',     type: 'textarea' },
      { key: 'btn_text', label: 'Button Text', type: 'text' },
      { key: 'btn_link', label: 'Button Link', type: 'text' },
    ],
    images: [{ key: 'bg_image', label: 'Background Image (optional)' }],
  },
  cards: {
    label: 'Cards Section', icon: '⊞',
    desc: 'Heading + up to 4 feature cards',
    fields: [
      { key: 'heading', label: 'Section Heading', type: 'text' },
      { key: 'subtext', label: 'Section Subtext',  type: 'textarea' },
      { key: 'card1_title', label: 'Card 1 Title', type: 'text' },
      { key: 'card1_body',  label: 'Card 1 Body',  type: 'textarea' },
      { key: 'card2_title', label: 'Card 2 Title', type: 'text' },
      { key: 'card2_body',  label: 'Card 2 Body',  type: 'textarea' },
      { key: 'card3_title', label: 'Card 3 Title', type: 'text' },
      { key: 'card3_body',  label: 'Card 3 Body',  type: 'textarea' },
      { key: 'card4_title', label: 'Card 4 Title', type: 'text' },
      { key: 'card4_body',  label: 'Card 4 Body',  type: 'textarea' },
    ],
    images: [
      { key: 'card1_image', label: 'Card 1 Image' },
      { key: 'card2_image', label: 'Card 2 Image' },
      { key: 'card3_image', label: 'Card 3 Image' },
      { key: 'card4_image', label: 'Card 4 Image' },
    ],
  },
  faq: {
    label: 'FAQ', icon: '?',
    desc: 'Frequently asked questions accordion',
    fields: [
      { key: 'heading', label: 'Section Heading', type: 'text' },
      { key: 'q1', label: 'Question 1', type: 'text' }, { key: 'a1', label: 'Answer 1', type: 'textarea' },
      { key: 'q2', label: 'Question 2', type: 'text' }, { key: 'a2', label: 'Answer 2', type: 'textarea' },
      { key: 'q3', label: 'Question 3', type: 'text' }, { key: 'a3', label: 'Answer 3', type: 'textarea' },
      { key: 'q4', label: 'Question 4', type: 'text' }, { key: 'a4', label: 'Answer 4', type: 'textarea' },
      { key: 'q5', label: 'Question 5', type: 'text' }, { key: 'a5', label: 'Answer 5', type: 'textarea' },
    ],
    images: [],
  },
};

// ── GET /admin/sections ──────────────────────────────────────────────────────
router.get('/', (req, res) => res.redirect('/admin/design'));

router.get('/legacy', async (req, res) => {
  const db = req.db;
  const [rawCopy, rawDesign, rawMedia, customSections] = await Promise.all([
    db.collection('copy').find({}).toArray(),
    db.collection('design').find({}).toArray(),
    db.collection('section_media').find({}).toArray(),
    db.collection('custom_sections').find({}).sort({ order: 1, createdAt: 1 }).toArray(),
  ]);

  const copy = { ...COPY_DEFAULTS };
  for (const item of rawCopy) copy[item.key] = item.value;

  const design = { ...DESIGN_DEFAULTS };
  for (const item of rawDesign) design[item.key] = item.value;

  const media = {};
  for (const item of rawMedia) media[item.key] = item;

  res.render('admin/sections/index', {
    user: req.adminUser, page: 'sections', title: 'Sections',
    sections: SECTIONS_META, copy, design, media, labels: COPY_LABELS,
    customSections, templates: CUSTOM_TEMPLATES,
    flash: req.query.saved, error: req.query.error,
  });
});

// ── HARDCODED SECTION: save copy ─────────────────────────────────────────────
router.post('/:section/copy', async (req, res) => {
  const { section } = req.params;
  const meta = SECTIONS_META[section];
  if (!meta) return res.status(404).json({ error: 'Unknown section' });

  try {
    const db = req.db;
    const ops = meta.copyKeys.map(key => {
      const value = (req.body[key] || '').trim();
      return db.collection('copy').updateOne(
        { key }, { $set: { key, value, updatedAt: new Date() } }, { upsert: true }
      );
    });
    const visKey = `vis_${section}`;
    if (visKey in DESIGN_DEFAULTS) {
      const visValue = req.body[visKey] === 'on' ? 'true' : 'false';
      ops.push(db.collection('design').updateOne(
        { key: visKey }, { $set: { key: visKey, value: visValue, updatedAt: new Date() } }, { upsert: true }
      ));
    }
    await Promise.all(ops);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── HARDCODED SECTION: upload image ──────────────────────────────────────────
router.post('/:section/image', (req, res) => {
  const { section } = req.params;
  if (!SECTIONS_META[section]) return res.status(404).json({ error: 'Unknown section' });

  sectionUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const imageKey = req.body.imageKey || SECTIONS_META[section].images[0]?.key;
    if (!imageKey) return res.status(400).json({ error: 'Missing imageKey' });
    try {
      const db = req.db;
      const url = req.file.location || `https://${BUCKET}.us-ord-1.linodeobjects.com/${req.file.key}`;
      const existing = await db.collection('section_media').findOne({ key: imageKey });
      if (existing?.bucketKey) {
        try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: existing.bucketKey })); } catch {}
      }
      await db.collection('section_media').updateOne(
        { key: imageKey },
        { $set: { key: imageKey, section, url, bucketKey: req.file.key, updatedAt: new Date() } },
        { upsert: true }
      );
      res.json({ ok: true, url, key: imageKey });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ── HARDCODED SECTION: set image from asset URL (no upload) ──────────────────
router.post('/:section/image-url', async (req, res) => {
  const { section } = req.params;
  if (!SECTIONS_META[section]) return res.status(404).json({ error: 'Unknown section' });
  const { imageKey, url } = req.body;
  if (!imageKey || !url) return res.status(400).json({ error: 'imageKey and url required' });
  try {
    const db = req.db;
    await db.collection('section_media').updateOne(
      { key: imageKey },
      { $set: { key: imageKey, section, url, bucketKey: '', updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, url, key: imageKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HARDCODED SECTION: delete image ──────────────────────────────────────────
router.delete('/:section/image/:imageKey', async (req, res) => {
  const { section, imageKey } = req.params;
  if (!SECTIONS_META[section]) return res.status(404).json({ error: 'Unknown section' });
  try {
    const db = req.db;
    const existing = await db.collection('section_media').findOne({ key: imageKey });
    if (existing?.bucketKey) {
      try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: existing.bucketKey })); } catch {}
    }
    await db.collection('section_media').deleteOne({ key: imageKey });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CUSTOM SECTIONS: create ───────────────────────────────────────────────────
router.post('/custom/new', async (req, res) => {
  const { type, label } = req.body;
  if (!CUSTOM_TEMPLATES[type]) return res.status(400).json({ error: 'Unknown template type' });
  if (!label?.trim()) return res.status(400).json({ error: 'Label required' });
  try {
    const db = req.db;
    const count = await db.collection('custom_sections').countDocuments();
    const result = await db.collection('custom_sections').insertOne({
      type, label: label.trim(), visible: true,
      order: count, fields: {}, images: {},
      createdAt: new Date(), updatedAt: new Date(),
    });
    res.json({ ok: true, id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CUSTOM SECTIONS: save copy ───────────────────────────────────────────────
router.post('/custom/:id/copy', async (req, res) => {
  try {
    const db = req.db;
    const sec = await db.collection('custom_sections').findOne({ _id: new ObjectId(req.params.id) });
    if (!sec) return res.status(404).json({ error: 'Section not found' });
    const tmpl = CUSTOM_TEMPLATES[sec.type];
    if (!tmpl) return res.status(400).json({ error: 'Unknown type' });

    const fields = {};
    for (const f of tmpl.fields) fields[f.key] = (req.body[f.key] || '').trim();

    const visible = req.body.visible === 'on';
    await db.collection('custom_sections').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { fields, visible, updatedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CUSTOM SECTIONS: upload image ────────────────────────────────────────────
router.post('/custom/:id/image', (req, res) => {
  sectionUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { imageKey } = req.body;
    if (!imageKey) return res.status(400).json({ error: 'Missing imageKey' });
    try {
      const db = req.db;
      const sec = await db.collection('custom_sections').findOne({ _id: new ObjectId(req.params.id) });
      if (!sec) return res.status(404).json({ error: 'Section not found' });

      // Delete old S3 object if exists
      const oldKey = sec.images?.[imageKey]?.bucketKey;
      if (oldKey) {
        try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey })); } catch {}
      }

      const url = req.file.location || `https://${BUCKET}.us-ord-1.linodeobjects.com/${req.file.key}`;
      await db.collection('custom_sections').updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { [`images.${imageKey}`]: { url, bucketKey: req.file.key }, updatedAt: new Date() } }
      );
      res.json({ ok: true, url, key: imageKey });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ── CUSTOM SECTIONS: set image from asset URL (no upload) ────────────────────
router.post('/custom/:id/image-url', async (req, res) => {
  const { imageKey, url } = req.body;
  if (!imageKey || !url) return res.status(400).json({ error: 'imageKey and url required' });
  try {
    const db = req.db;
    const sec = await db.collection('custom_sections').findOne({ _id: new ObjectId(req.params.id) });
    if (!sec) return res.status(404).json({ error: 'Not found' });
    await db.collection('custom_sections').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { [`images.${imageKey}`]: { url, bucketKey: '' }, updatedAt: new Date() } }
    );
    res.json({ ok: true, url, key: imageKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CUSTOM SECTIONS: delete image ────────────────────────────────────────────
router.delete('/custom/:id/image/:imageKey', async (req, res) => {
  try {
    const db = req.db;
    const sec = await db.collection('custom_sections').findOne({ _id: new ObjectId(req.params.id) });
    if (!sec) return res.status(404).json({ error: 'Not found' });
    const oldKey = sec.images?.[req.params.imageKey]?.bucketKey;
    if (oldKey) {
      try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey })); } catch {}
    }
    await db.collection('custom_sections').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $unset: { [`images.${req.params.imageKey}`]: '' }, $set: { updatedAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CUSTOM SECTIONS: delete section ──────────────────────────────────────────
router.delete('/custom/:id', async (req, res) => {
  try {
    const db = req.db;
    const sec = await db.collection('custom_sections').findOne({ _id: new ObjectId(req.params.id) });
    if (!sec) return res.status(404).json({ error: 'Not found' });
    // Clean up S3 images
    for (const img of Object.values(sec.images || {})) {
      if (img.bucketKey) {
        try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: img.bucketKey })); } catch {}
      }
    }
    await db.collection('custom_sections').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AGENT ─────────────────────────────────────────────────────────────────────
router.post('/agent', async (req, res) => {
  const { messages, section, currentCopy, customSection } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  // Build field list for prompt — hardcoded or custom
  let fieldList, sectionLabel;
  if (customSection) {
    const tmpl = CUSTOM_TEMPLATES[customSection.type];
    fieldList = tmpl ? tmpl.fields.map(f => f.key).join(', ') : '';
    sectionLabel = customSection.label;
  } else {
    const meta = section ? SECTIONS_META[section] : null;
    fieldList = meta ? meta.copyKeys.join(', ') : Object.keys(COPY_LABELS).join(', ');
    sectionLabel = meta?.label || 'site';
  }

  const copyCtx = currentCopy
    ? `\n\nCurrent values:\n${Object.entries(currentCopy).map(([k,v]) => `  ${k}: "${v}"`).join('\n')}`
    : '';

  const brandCtx = await loadBrandContext(req.tenant, req.db);

  const systemPrompt = `You are a professional copywriting assistant for the business.

${brandCtx}

You are editing the "${sectionLabel}" section. Write compelling, conversion-focused copy tailored to the business and its audience as described above.

RESPOND WITH RAW JSON ONLY — no markdown, no extra text:
{"message":"Brief note on what you wrote.","fill":{"field_key":"value"}}
If chatting only: {"message":"response","fill":{}}

Fields available for this section: ${fieldList}${copyCtx}`;

  try {
    const raw = await callLLM(messages, systemPrompt);
    const parsed = tryParseAgentResponse(raw);
    res.json(parsed);
  } catch (err) {
    console.error('Section agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
