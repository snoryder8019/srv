/**
 * Slab — Onboarding Form Builder Routes
 * /admin/onboarding           → list all forms
 * /admin/onboarding/new       → builder (new)
 * /admin/onboarding/:id       → builder (edit)
 * /admin/onboarding/:id/responses → view responses
 * /admin/onboarding/:id/agent → AI field suggestions
 */

import express from 'express';
import { ObjectId } from 'mongodb';
import { callLLM, tryParseAgentResponse } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';
import { DESIGN_DEFAULTS } from './design.js';

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ── LIST all forms ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = req.db;
  const forms = await db.collection('onboarding_forms')
    .find({ status: { $ne: 'archived' } })
    .sort({ updatedAt: -1 })
    .toArray();

  // Get response counts per form
  const formIds = forms.map(f => f._id);
  const countPipeline = [
    { $match: { formId: { $in: formIds } } },
    { $group: { _id: '$formId', count: { $sum: 1 } } },
  ];
  const counts = await db.collection('onboarding_responses').aggregate(countPipeline).toArray();
  const countMap = {};
  counts.forEach(c => { countMap[c._id.toString()] = c.count; });

  res.render('admin/onboarding/index', {
    user: req.adminUser,
    page: 'onboarding',
    title: 'Onboarding Forms',
    forms,
    countMap,
    msg: req.query.msg || '',
    err: req.query.error || '',
  });
});

// ── NEW form (builder) ──────────────────────────────────────────────────────
router.get('/new', async (req, res) => {
  const db = req.db;
  const otherForms = await db.collection('onboarding_forms')
    .find({ status: 'active' })
    .project({ name: 1, slug: 1, fields: 1 })
    .toArray();

  res.render('admin/onboarding/builder', {
    user: req.adminUser,
    page: 'onboarding',
    title: 'New Onboarding Form',
    form: null,
    otherForms,
    err: req.query.error || '',
  });
});

// ── PREVIEW form ────────────────────────────────────────────────────────────
router.get('/:id/preview', async (req, res) => {
  const db = req.db;
  let form;
  try {
    form = await db.collection('onboarding_forms').findOne({ _id: new ObjectId(req.params.id) });
  } catch { /* invalid id */ }
  if (!form) return res.redirect('/admin/onboarding');

  res.render('admin/onboarding/preview', {
    user: req.adminUser,
    page: 'onboarding',
    title: 'Preview: ' + form.name,
    form,
  });
});

// ── AGENT — suggest fields for NEW form (no ID yet) ────────────────────────
router.post('/agent/suggest', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const brandContext = await loadBrandContext(req.tenant, db, DESIGN_DEFAULTS);
    const prompt = req.body.prompt || 'Suggest onboarding form fields for this business';

    const systemPrompt = `You are a form design assistant for a business onboarding platform.
${brandContext}

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the suggested fields",
  "fill": {
    "fields": [
      {
        "key": "field_key_snake_case",
        "label": "Human Readable Label",
        "type": "text|textarea|select|checkbox|radio|number|email|url|date|color|heading",
        "placeholder": "hint text",
        "helpText": "optional guidance for the respondent",
        "required": true,
        "options": [{"label": "Option A", "value": "a"}],
        "width": "full|half",
        "section": "Section Name"
      }
    ]
  }
}

Field types: text, textarea, select, checkbox, radio, number, email, url, date, color, heading (section divider).
Only include "options" for select/radio/checkbox types.
Generate 4-8 useful fields based on the business type and user prompt.`;

    const raw = await callLLM(
      [{ role: 'user', content: prompt }],
      systemPrompt,
    );
    const parsed = tryParseAgentResponse(raw);
    res.json({ success: true, message: parsed.message || 'Fields suggested', fields: parsed.fill?.fields || [] });
  } catch (err) {
    console.error('[Onboarding] Agent suggest error:', err);
    res.status(500).json({ error: err.message || 'Agent failed' });
  }
});

// ── API: get forms assigned to a page slug ──────────────────────────────────
router.get('/api/by-page/:pageSlug', async (req, res) => {
  try {
    const db = req.db;
    const forms = await db.collection('onboarding_forms')
      .find({ status: 'active', assignTo: req.params.pageSlug })
      .sort({ updatedAt: -1 })
      .toArray();
    res.json({ forms });
  } catch (err) {
    res.json({ forms: [] });
  }
});

// ── CREATE form ─────────────────────────────────────────────────────────────
router.post('/', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const { name, description, status, fields, assignTo } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

    const slug = slugify(name);
    const existing = await db.collection('onboarding_forms').findOne({ slug });
    const finalSlug = existing ? slug + '-' + Date.now().toString(36) : slug;

    const doc = {
      name: name.trim(),
      slug: finalSlug,
      description: (description || '').trim(),
      status: status || 'draft',
      fields: Array.isArray(fields) ? fields : [],
      assignTo: Array.isArray(assignTo) ? assignTo : [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('onboarding_forms').insertOne(doc);
    res.json({ ok: true, id: result.insertedId, slug: finalSlug });
  } catch (err) {
    console.error('[Onboarding] Create error:', err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// ── EDIT form (builder) ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const db = req.db;
  let form;
  try {
    form = await db.collection('onboarding_forms').findOne({ _id: new ObjectId(req.params.id) });
  } catch { /* invalid id */ }
  if (!form) return res.redirect('/admin/onboarding');

  const otherForms = await db.collection('onboarding_forms')
    .find({ status: 'active', _id: { $ne: form._id } })
    .project({ name: 1, slug: 1, fields: 1 })
    .toArray();

  res.render('admin/onboarding/builder', {
    user: req.adminUser,
    page: 'onboarding',
    title: 'Edit: ' + form.name,
    form,
    otherForms,
    err: req.query.error || '',
  });
});

// ── UPDATE form ─────────────────────────────────────────────────────────────
router.post('/:id', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const { name, description, status, fields, assignTo } = req.body;

    const update = {
      $set: {
        name: (name || '').trim(),
        description: (description || '').trim(),
        status: status || 'draft',
        fields: Array.isArray(fields) ? fields : [],
        assignTo: Array.isArray(assignTo) ? assignTo : [],
        updatedAt: new Date(),
      },
    };

    await db.collection('onboarding_forms').updateOne(
      { _id: new ObjectId(req.params.id) },
      update,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[Onboarding] Update error:', err);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// ── DUPLICATE form ──────────────────────────────────────────────────────────
router.post('/:id/duplicate', async (req, res) => {
  try {
    const db = req.db;
    const original = await db.collection('onboarding_forms').findOne({ _id: new ObjectId(req.params.id) });
    if (!original) return res.redirect('/admin/onboarding');

    const copy = {
      name: original.name + ' (Copy)',
      slug: original.slug + '-copy-' + Date.now().toString(36),
      description: original.description,
      status: 'draft',
      fields: original.fields,
      assignTo: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('onboarding_forms').insertOne(copy);
    res.redirect('/admin/onboarding?msg=duplicated');
  } catch (err) {
    console.error('[Onboarding] Duplicate error:', err);
    res.redirect('/admin/onboarding?error=1');
  }
});

// ── DELETE (archive) form ───────────────────────────────────────────────────
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('onboarding_forms').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'archived', updatedAt: new Date() } },
    );
    res.redirect('/admin/onboarding?msg=archived');
  } catch (err) {
    res.redirect('/admin/onboarding?error=1');
  }
});

// ── RESPONSES list ──────────────────────────────────────────────────────────
router.get('/:id/responses', async (req, res) => {
  const db = req.db;
  let form;
  try {
    form = await db.collection('onboarding_forms').findOne({ _id: new ObjectId(req.params.id) });
  } catch { /* invalid id */ }
  if (!form) return res.redirect('/admin/onboarding');

  const responses = await db.collection('onboarding_responses')
    .find({ formId: form._id })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  // Resolve client names
  const clientIds = responses.filter(r => r.clientId).map(r => r.clientId);
  const clients = clientIds.length
    ? await db.collection('clients').find({ _id: { $in: clientIds } }).project({ name: 1, email: 1 }).toArray()
    : [];
  const clientMap = {};
  clients.forEach(c => { clientMap[c._id.toString()] = c; });

  res.render('admin/onboarding/responses', {
    user: req.adminUser,
    page: 'onboarding',
    title: 'Responses: ' + form.name,
    form,
    responses,
    clientMap,
  });
});

// ── SUBMIT response (used by preview & client onboarding tab) ───────────────
router.post('/:id/submit', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const form = await db.collection('onboarding_forms').findOne({ _id: new ObjectId(req.params.id) });
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const { data, clientId, respondentEmail, respondentName, pipedData } = req.body;

    const doc = {
      formId: form._id,
      formSlug: form.slug,
      clientId: clientId ? new ObjectId(clientId) : null,
      respondentEmail: respondentEmail || '',
      respondentName: respondentName || '',
      data: data || {},
      pipedData: pipedData || {},
      completedAt: new Date(),
      createdAt: new Date(),
    };

    await db.collection('onboarding_responses').insertOne(doc);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Onboarding] Submit error:', err);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

// ── PIPE data (fetch latest response for a source form + client/email) ──────
router.get('/:id/pipe', async (req, res) => {
  try {
    const db = req.db;
    const { clientId, email } = req.query;
    const query = { formId: new ObjectId(req.params.id) };
    if (clientId) query.clientId = new ObjectId(clientId);
    else if (email) query.respondentEmail = email;
    else return res.json({ data: {} });

    const latest = await db.collection('onboarding_responses')
      .findOne(query, { sort: { createdAt: -1 } });

    res.json({ data: latest?.data || {} });
  } catch (err) {
    res.json({ data: {} });
  }
});

// ── AGENT — suggest fields ──────────────────────────────────────────────────
router.post('/:id/agent', express.json(), async (req, res) => {
  try {
    const db = req.db;
    const form = await db.collection('onboarding_forms').findOne({ _id: new ObjectId(req.params.id) });
    const brandContext = await loadBrandContext(req.tenant, db, DESIGN_DEFAULTS);
    const existingFields = form?.fields?.map(f => f.label).join(', ') || 'none';

    const prompt = req.body.prompt || 'Suggest onboarding form fields for this business';

    const systemPrompt = `You are a form design assistant for a business onboarding platform.
${brandContext}

The form currently has these fields: ${existingFields}

Output ONLY a raw JSON object. No prose, no markdown fences. Shape:
{
  "message": "one sentence describing the suggested fields",
  "fill": {
    "fields": [
      {
        "key": "field_key_snake_case",
        "label": "Human Readable Label",
        "type": "text|textarea|select|checkbox|radio|number|email|url|date|color|heading",
        "placeholder": "hint text",
        "helpText": "optional guidance for the respondent",
        "required": true,
        "options": [{"label": "Option A", "value": "a"}],
        "width": "full|half",
        "section": "Section Name"
      }
    ]
  }
}

Field types: text, textarea, select, checkbox, radio, number, email, url, date, color, heading (section divider).
Only include "options" for select/radio/checkbox types.
Generate 4-8 useful fields based on the business type and user prompt.
Do NOT duplicate fields that already exist on the form.`;

    const raw = await callLLM(
      [{ role: 'user', content: prompt }],
      systemPrompt,
    );
    const parsed = tryParseAgentResponse(raw);
    res.json({ success: true, message: parsed.message || 'Fields suggested', fields: parsed.fill?.fields || [] });
  } catch (err) {
    console.error('[Onboarding] Agent error:', err);
    res.status(500).json({ error: err.message || 'Agent failed' });
  }
});

export default router;
