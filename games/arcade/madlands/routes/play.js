/**
 * Play runtime API.
 *   POST /api/play/report  -> hand a finished run's score to the platform
 *                             master leaderboard (uses the session user's identity).
 * Guests (no platform identity) are accepted but not reported.
 */
import express from 'express';
import { reportScore } from '../services/platform/report.js';

const router = express.Router();

router.post('/report', express.json(), async (req, res) => {
  const u = req.session?.user;
  const { score = 0, status = 'abandoned', durationMs = 0, meta = {} } = req.body || {};
  if (!u || !u.platformId) return res.json({ ok: true, reported: false, reason: 'guest' });
  const r = await reportScore({ platformId: u.platformId, displayName: u.displayName, score, status, durationMs, meta });
  res.json({ ok: true, reported: !!r.ok, platform: r });
});

export default router;
