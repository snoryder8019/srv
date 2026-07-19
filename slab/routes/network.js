/**
 * sLab Network — public hub at /network (canonical host: slab.madladslab.com).
 *
 * Mounted ABOVE the tenant index router and reads only the registry DB, so it
 * works whether or not a tenant resolved for the host (on the bare platform host
 * req.db is undefined — this route never touches it).
 */
import express from 'express';
import { buildNetworkData, joinWaitlist, followMembers } from '../plugins/network.js';

const router = express.Router();

// ── The hub ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const data = await buildNetworkData();
    res.render('network/index', {
      data,
      joined: req.query.joined || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[network] render failed:', err);
    next(err);
  }
});

// ── Inference-mesh waitlist capture ───────────────────────────────────────────
router.post('/waitlist', async (req, res) => {
  const wantsJson = (req.headers.accept || '').includes('application/json');
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
    const result = await joinWaitlist({
      email: req.body.email,
      name: req.body.name,
      note: req.body.note,
      location: req.body.location,
      ip,
    });
    const msg = result.status === 'invalid' ? 'Please enter a valid email.'
      : result.status === 'exists' ? "You're already on the list — we'll be in touch."
      : "You're on the list. We'll reach out as the mesh opens up.";
    if (wantsJson) return res.json({ ok: result.ok, status: result.status, message: msg });
    return res.redirect('/network?joined=' + result.status + '#waitlist');
  } catch (err) {
    console.error('[network] waitlist failed:', err);
    if (wantsJson) return res.status(500).json({ ok: false, message: 'Something went wrong — try again.' });
    return res.redirect('/network?error=waitlist#waitlist');
  }
});

// ── Follow many — one email subscribes to several members' newsletters ────────
router.post('/follow', async (req, res) => {
  try {
    const result = await followMembers({ email: req.body.email, keys: req.body.keys });
    const message = result.status === 'invalid'
      ? 'Please enter a valid email.'
      : result.subscribed
        ? `Done — you're following ${result.subscribed} brand${result.subscribed === 1 ? '' : 's'} on the network.`
        : 'Pick at least one brand to follow.';
    return res.json({ ok: result.ok, status: result.status, subscribed: result.subscribed, message });
  } catch (err) {
    console.error('[network] follow failed:', err);
    return res.status(500).json({ ok: false, message: 'Something went wrong — try again.' });
  }
});

export default router;
