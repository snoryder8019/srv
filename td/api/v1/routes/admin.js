/**
 * Admin balance API - all routes require the 'admin' role. Mounted at /api/v1/admin.
 *
 * Build & balance the four content pieces:
 *   CHARACTERS : enemy-types, towers
 *   BOARDS     : maps        (geometry; painted in /build/map)
 *   LEVELS     : levels      (a map + waves + modifiers)
 */
import express from 'express';
import { requireRole } from '../middleware/auth.js';
import Tower from '../models/Tower.js';
import GameMap from '../models/Map.js';
import EnemyType from '../models/EnemyType.js';
import Level from '../models/Level.js';

const router = express.Router();
router.use(requireRole('admin'));

const ok = (res, data) => res.json({ success: true, ...data });
const fail = (res, code, error) => res.status(code).json({ success: false, error });
const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  || ('x' + Date.now());

/* --------------------------- enemy types (characters) --------------------------- */
router.get('/enemy-types', async (req, res) => {
  ok(res, { types: await EnemyType.find().sort({ slug: 1 }).lean() });
});
router.post('/enemy-types', async (req, res) => {
  try {
    const { slug, name, hp, speed, reward, color, model, enabled } = req.body;
    if (!slug || !name) return fail(res, 400, 'slug and name required');
    const doc = await EnemyType.create({ slug: slugify(slug), name, hp, speed, reward, color, model, enabled });
    ok(res, { type: doc.toObject() });
  } catch (e) { fail(res, 400, e.message); }
});
router.patch('/enemy-types/:slug', async (req, res) => {
  const allow = ['name', 'hp', 'speed', 'reward', 'color', 'model', 'enabled'];
  const $set = {};
  for (const k of allow) if (k in req.body) $set[k] = req.body[k];
  const doc = await EnemyType.findOneAndUpdate({ slug: req.params.slug }, { $set }, { new: true }).lean();
  if (!doc) return fail(res, 404, 'enemy type not found');
  ok(res, { type: doc });
});
router.delete('/enemy-types/:slug', async (req, res) => {
  ok(res, { deleted: (await EnemyType.deleteOne({ slug: req.params.slug })).deletedCount });
});

/* --------------------------- towers (characters) --------------------------- */
router.get('/towers', async (req, res) => {
  ok(res, { towers: await Tower.find().sort({ updatedAt: -1 }).lean() });
});
router.post('/towers', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return fail(res, 400, 'name required');
    const doc = await Tower.create({
      name: b.name,
      slug: slugify(b.slug || b.name),
      description: b.description || '',
      category: b.category || 'kinetic',
      gltfUrl: b.gltfUrl || '',
      scale: typeof b.scale === 'number' ? b.scale : 1,
      stats: {
        damage: b.stats?.damage ?? 10, range: b.stats?.range ?? 3,
        fireRate: b.stats?.fireRate ?? 1, cost: b.stats?.cost ?? 50,
        projectileSpeed: b.stats?.projectileSpeed ?? 5,
      },
      behavior: {
        targeting: b.behavior?.targeting || 'nearest',
        canHitFlying: b.behavior?.canHitFlying ?? true,
        splashRadius: b.behavior?.splashRadius ?? 0,
      },
      status: b.status || 'approved',
    });
    ok(res, { tower: doc.toObject() });
  } catch (e) { fail(res, 400, e.message); }
});
router.patch('/towers/:id', async (req, res) => {
  try {
    const tower = await Tower.findById(req.params.id);
    if (!tower) return fail(res, 404, 'tower not found');
    if (typeof req.body.name === 'string') tower.name = req.body.name;
    if (typeof req.body.status === 'string') tower.status = req.body.status;
    if (typeof req.body.category === 'string') tower.category = req.body.category;
    if (typeof req.body.scale === 'number') tower.scale = req.body.scale;
    if (req.body.stats && typeof req.body.stats === 'object') {
      const allow = ['damage', 'range', 'fireRate', 'cost', 'projectileSpeed'];
      for (const k of allow) if (k in req.body.stats) tower.stats[k] = Number(req.body.stats[k]);
    }
    if (req.body.behavior && typeof req.body.behavior === 'object') {
      if ('targeting' in req.body.behavior) tower.behavior.targeting = req.body.behavior.targeting;
      if ('splashRadius' in req.body.behavior) tower.behavior.splashRadius = Number(req.body.behavior.splashRadius);
      if ('canHitFlying' in req.body.behavior) tower.behavior.canHitFlying = !!req.body.behavior.canHitFlying;
    }
    await tower.save();
    ok(res, { tower: tower.toObject() });
  } catch (e) { fail(res, 400, e.message); }
});
router.delete('/towers/:id', async (req, res) => {
  ok(res, { deleted: (await Tower.deleteOne({ _id: req.params.id })).deletedCount });
});

/* --------------------------- maps (boards) --------------------------- */
router.get('/maps', async (req, res) => {
  ok(res, { maps: await GameMap.find().sort({ updatedAt: -1 }).lean() });
});
router.post('/maps', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return fail(res, 400, 'name required');
    const doc = await GameMap.create({
      name: b.name, slug: slugify(b.slug || b.name),
      description: b.description || '',
      radius: b.radius || 6, status: b.status || 'draft',
      spawnHexes: b.spawnHexes || [], baseHexes: b.baseHexes || [],
      pathHexes: b.pathHexes || [], blockedHexes: b.blockedHexes || [],
      authorId: req.user._id, authorName: req.user.displayName,
    });
    ok(res, { map: doc.toObject() });
  } catch (e) { fail(res, 400, e.message); }
});
router.patch('/maps/:id', async (req, res) => {
  try {
    const map = await GameMap.findById(req.params.id);
    if (!map) return fail(res, 404, 'map not found');
    for (const k of ['name', 'status', 'radius', 'description']) if (k in req.body) map[k] = req.body[k];
    for (const hk of ['pathHexes', 'spawnHexes', 'baseHexes', 'blockedHexes']) {
      if (Array.isArray(req.body[hk])) map[hk] = req.body[hk];
    }
    await map.save();
    ok(res, { map: map.toObject() });
  } catch (e) { fail(res, 400, e.message); }
});
router.delete('/maps/:id', async (req, res) => {
  const used = await Level.countDocuments({ mapId: req.params.id });
  if (used > 0) return fail(res, 409, `map is used by ${used} level(s)`);
  ok(res, { deleted: (await GameMap.deleteOne({ _id: req.params.id })).deletedCount });
});

/* --------------------------- levels (map + waves) --------------------------- */
router.get('/levels', async (req, res) => {
  const levels = await Level.find().sort({ order: 1, updatedAt: -1 })
    .populate('mapId', 'name slug radius').lean();
  ok(res, { levels });
});
router.get('/levels/:id', async (req, res) => {
  const level = await Level.findById(req.params.id).lean();
  if (!level) return fail(res, 404, 'level not found');
  ok(res, { level });
});
router.post('/levels', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return fail(res, 400, 'name required');
    if (!b.mapId) return fail(res, 400, 'mapId required');
    const map = await GameMap.findById(b.mapId);
    if (!map) return fail(res, 400, 'mapId does not reference a real map');
    const doc = await Level.create({
      name: b.name, slug: slugify(b.slug || b.name),
      description: b.description || '',
      mapId: b.mapId,
      waves: Array.isArray(b.waves) ? b.waves : [],
      modifiers: b.modifiers || {},
      status: b.status || 'draft',
      order: b.order || 0,
      authorId: req.user._id, authorName: req.user.displayName,
    });
    ok(res, { level: doc.toObject() });
  } catch (e) { fail(res, 400, e.message); }
});
router.patch('/levels/:id', async (req, res) => {
  try {
    const level = await Level.findById(req.params.id);
    if (!level) return fail(res, 404, 'level not found');
    for (const k of ['name', 'description', 'status', 'order']) if (k in req.body) level[k] = req.body[k];
    if (req.body.mapId) {
      const map = await GameMap.findById(req.body.mapId);
      if (!map) return fail(res, 400, 'mapId does not reference a real map');
      level.mapId = req.body.mapId;
    }
    if (Array.isArray(req.body.waves)) level.waves = req.body.waves;
    if (req.body.modifiers && typeof req.body.modifiers === 'object') {
      level.modifiers = { ...level.modifiers?.toObject?.() ?? level.modifiers, ...req.body.modifiers };
    }
    await level.save();
    ok(res, { level: level.toObject() });
  } catch (e) { fail(res, 400, e.message); }
});
router.delete('/levels/:id', async (req, res) => {
  ok(res, { deleted: (await Level.deleteOne({ _id: req.params.id })).deletedCount });
});

export default router;
