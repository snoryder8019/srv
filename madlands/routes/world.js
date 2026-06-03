/**
 * Public world API (no auth). Boards form a tree; a board's address is a PATH
 * of hex segments (the descent breadcrumb). A build's hexKey IS that path.
 *   GET /api/world?path=P    -> on board P, which next-hexes have content below
 *   GET /api/scene?path=P    -> MASTER-COMPOSED scene for board P (builds w/ hexKey===P)
 *   GET /api/hex/:hexKey      -> raw builds for an exact key (builds manager)
 */
import express from 'express';
import { dbReady } from '../services/db.js';
import Build from '../models/Build.js';
import { composeHex } from '../services/agents/master.js';

const router = express.Router();

// markers: on board P, the next-segment hexes that have any content at/below them
router.get('/world', async (req, res) => {
  const P = req.query.path || '';
  if (!dbReady()) return res.json({ ok: true, path: P, hexes: [] });
  try {
    const builds = await Build.find({ hexKey: { $ne: null } }).select('hexKey kind').lean();
    const pSegs = P ? P.split('/') : [];
    const map = {};
    for (const b of builds) {
      const aSegs = String(b.hexKey || '').split('/');
      if (aSegs.length <= pSegs.length) continue;
      if (!pSegs.every((s, i) => aSegs[i] === s)) continue;
      const h = aSegs[pSegs.length];
      (map[h] ||= new Set()).add(b.kind);
    }
    res.json({ ok: true, path: P, hexes: Object.entries(map).map(([hexKey, kinds]) => ({ hexKey, kinds: [...kinds] })) });
  } catch (e) { res.json({ ok: true, path: P, hexes: [], error: e.message }); }
});

// composed scene for the board at path P (content placed directly on it)
router.get('/scene', async (req, res) => {
  const P = req.query.path || '';
  if (!dbReady()) return res.json(composeHex(P, []));
  try {
    const list = await Build.find({ hexKey: P }).sort({ updatedAt: -1 }).lean();
    res.json(composeHex(P, list));
  } catch (e) { res.json({ ok: false, path: P, error: e.message }); }
});

// raw builds for an exact key (used by the builds manager / debugging)
router.get('/hex/:hexKey', async (req, res) => {
  const hexKey = req.params.hexKey;
  if (!dbReady()) return res.json({ ok: true, hexKey, builds: {} });
  try {
    const list = await Build.find({ hexKey }).sort({ updatedAt: -1 }).lean();
    const byKind = {};
    for (const b of list) if (!byKind[b.kind]) byKind[b.kind] = b.output || {};
    res.json({ ok: true, hexKey, builds: byKind });
  } catch (e) { res.json({ ok: true, hexKey, builds: {}, error: e.message }); }
});

export default router;
