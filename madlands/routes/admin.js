/**
 * Admin builder routes (canAdmin-gated).
 * Registry-driven generic builder + SD art + guardrails + tasking + builds tool.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { dbReady } from '../services/db.js';
import Build from '../models/Build.js';
import { getSpec, listSpecs, runKind } from '../services/agents/index.js';
import { nextSteps, taskBoard } from '../services/agents/director.js';
import { validateBuild } from '../services/agents/validate.js';
import { aiHealth, generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = path.join(__dirname, '..', 'public', 'assets', 'img', 'builds');
const router = express.Router();

function requireAdmin(req, res, next) {
  const u = req.session?.user;
  if (!u) return res.redirect('/auth/platform');
  if (!u.canAdmin) {
    if (req.accepts('json') && !req.accepts('html')) return res.status(403).json({ ok: false, error: 'admin only' });
    return res.status(403).send('Admin only.');
  }
  next();
}
router.use(requireAdmin);

// shell
router.get('/', async (req, res) => {
  let recent = [];
  if (dbReady()) { try { recent = await Build.find().sort({ updatedAt: -1 }).limit(20).lean(); } catch {} }
  res.render('admin/shell', { title: 'Madlands · Builder', currentUser: res.locals.currentUser, builders: listSpecs(), recent, dbReady: dbReady() });
});

// director: suggestions + completion task board
router.post('/director/next', async (req, res) => {
  let builds = [];
  if (dbReady()) { try { builds = await Build.find().select('kind tier hexKey name').lean(); } catch {} }
  res.json(await nextSteps(builds));
});
router.get('/director/board', async (req, res) => {
  let builds = [];
  if (dbReady()) { try { builds = await Build.find().select('kind tier hexKey name').lean(); } catch {} }
  res.json(taskBoard(builds));
});

// JSON list + builds manager view
router.get('/api/builds', async (req, res) => {
  if (!dbReady()) return res.json({ ok: true, builds: [], note: 'db offline' });
  const q = {};
  if (req.query.kind) q.kind = req.query.kind;
  if (req.query.hexKey) q.hexKey = req.query.hexKey;
  res.json({ ok: true, builds: await Build.find(q).sort({ updatedAt: -1 }).limit(80).lean() });
});
router.get('/api/ai-health', async (req, res) => res.json(await aiHealth()));

router.get('/builds', async (req, res) => {
  let builds = [];
  if (dbReady()) { try { builds = await Build.find().sort({ updatedAt: -1 }).limit(200).lean(); } catch {} }
  res.render('admin/builds', { title: 'Madlands · Builds', currentUser: res.locals.currentUser, builds, dbReady: dbReady() });
});

// build tooling: status workflow + delete (guardrailed)
const STATUSES = ['draft', 'ready', 'published'];
router.post('/build/:id/status', express.json(), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ ok: false, error: 'db offline' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const status = String(req.body?.status || '');
  if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'bad status' });
  const b = await Build.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true }).lean();
  if (!b) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, status: b.status });
});
router.post('/build/:id/delete', async (req, res) => {
  if (!dbReady()) return res.status(503).json({ ok: false, error: 'db offline' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, error: 'bad id' });
  await Build.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// SD art for environments
router.post('/environment/art', express.json(), async (req, res) => {
  const { skyPrompt, groundPrompt, tier = 'zone', hexKey = null, name } = req.body || {};
  if (!skyPrompt && !groundPrompt) return res.status(400).json({ ok: false, error: 'no prompts' });
  fs.mkdirSync(ART_DIR, { recursive: true });
  const id = String(hexKey || name || 'env').replace(/[^a-z0-9_-]/gi, '_') + '-' + Date.now();
  async function gen(prompt, suffix, opts) {
    if (!prompt) return null;
    const b64 = await generateImage(prompt, opts);
    if (!b64) return null;
    const file = `${id}-${suffix}.png`;
    fs.writeFileSync(path.join(ART_DIR, file), Buffer.from(b64, 'base64'));
    return '/assets/img/builds/' + file;
  }
  const skyUrl = await gen(skyPrompt, 'sky', { size: '768x512', steps: 22 });
  const groundUrl = await gen(groundPrompt, 'ground', { size: '512x512', steps: 22 });
  if (!skyUrl && !groundUrl) return res.status(502).json({ ok: false, error: 'sd_unavailable' });
  let buildId = null;
  if (dbReady()) {
    try {
      const { skyPrompt: sp, groundPrompt: gp, ...rest } = req.body || {};
      const saved = await Build.create({ kind: 'environment', tier, hexKey, name: name || 'environment', input: {}, output: { ...rest, name, tier, hexKey, skyPrompt: sp, groundPrompt: gp, skyUrl, groundUrl }, agent: 'environment', status: 'draft', createdBy: req.session.user.platformId });
      buildId = saved._id;
    } catch (e) { console.warn('[admin] art save failed:', e.message); }
  }
  res.json({ ok: true, skyUrl, groundUrl, buildId });
});

// generic builder form (prefill from ?hex= & ?tier= & ?name= via task links)
router.get('/:kind', (req, res, next) => {
  const spec = getSpec(req.params.kind);
  if (!spec) return next();
  const prefill = { hexKey: req.query.hex || '', tier: req.query.tier || '', name: req.query.name || '' };
  res.render('admin/builder', { title: `Builder · ${spec.name}`, currentUser: res.locals.currentUser, kind: spec.kind, specName: spec.name, blurb: spec.blurb, fields: spec.fields, prefill });
});

// run agent -> data + guardrail warnings (client fills the form)
router.post('/:kind/generate', express.json(), async (req, res) => {
  if (!getSpec(req.params.kind)) return res.status(404).json({ ok: false, error: 'unknown_kind' });
  const { tier = 'zone', hexKey = null, ...manual } = req.body || {};
  const result = await runKind(req.params.kind, manual, { tier, hexKey });
  if (result.ok) {
    const v = validateBuild(req.params.kind, { ...result.data, tier, hexKey });
    result.warnings = v.warnings;
    result.errors = v.errors;
  }
  res.status(result.ok ? 200 : 502).json(result);
});

// persist build — guardrail: hard errors block the save
router.post('/:kind/save', express.json(), async (req, res) => {
  const spec = getSpec(req.params.kind);
  if (!spec) return res.status(404).json({ ok: false, error: 'unknown_kind' });
  if (!dbReady()) return res.status(503).json({ ok: false, error: 'db offline' });
  const { tier = 'zone', hexKey = null, name, ...rest } = req.body || {};
  const data = { name, tier, hexKey, ...rest };
  const v = validateBuild(spec.kind, data);
  if (!v.ok) return res.status(422).json({ ok: false, error: 'validation_failed', errors: v.errors, warnings: v.warnings });
  try {
    const saved = await Build.create({ kind: spec.kind, tier, hexKey, name: name || rest.name || spec.kind, input: {}, output: data, agent: spec.kind, status: 'draft', createdBy: req.session.user.platformId });
    res.json({ ok: true, buildId: saved._id, warnings: v.warnings });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

export default router;
