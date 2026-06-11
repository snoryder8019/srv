// routes/dashboard.js — signed-in user home base: pitch dashboard + account settings.
import express from 'express';
import { requireUser } from '../plugins/mllAuth.js';
import {
  MAX_PITCHES,
  listUserPitches,
  countUserPitches,
  deletePitch,
  saveUser,
} from '../lib/store.js';

const router = express.Router();

// All dashboard routes require a signed-in madladslab user.
router.use(requireUser);

// GET /dashboard — list the user's pitches with cap + actions.
router.get('/', (req, res) => {
  const user = req.mllUser;
  const pitches = listUserPitches(user.id);
  const count = countUserPitches(user.id);
  const isSuper = !!user.isSuperadmin;
  const atCap = !isSuper && count >= MAX_PITCHES;
  res.render('dashboard/index', {
    title: 'Dashboard',
    pitches,
    count,
    max: MAX_PITCHES,
    isSuper,
    atCap,
  });
});

// POST /dashboard/pitch/:slug/delete — remove a pitch the user owns.
router.post('/pitch/:slug/delete', (req, res) => {
  deletePitch(req.params.slug, req.mllUser.id);
  res.redirect('/dashboard');
});

// GET /dashboard/settings — account + tenant/branding settings form.
router.get('/settings', (req, res) => {
  res.render('dashboard/settings', {
    title: 'Settings',
    saved: req.query.saved === '1',
    error: typeof req.query.error === 'string' ? req.query.error : null,
  });
});

// POST /dashboard/settings — merge form values into the user, persist.
router.post('/settings', (req, res) => {
  const user = req.mllUser;
  const b = req.body || {};

  // Validate defaultRate as a number >= 0; bounce back on bad input.
  const rate = Number.parseFloat(b.defaultRate);
  if (!Number.isFinite(rate) || rate < 0) {
    return res.redirect('/dashboard/settings?error=rate');
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  user.displayName = str(b.displayName) || user.displayName;
  user.settings = {
    ...user.settings,
    company: str(b.company),
    defaultRate: rate,
    brandColor: str(b.brandColor) || user.settings?.brandColor || '#0c1020',
    accent: str(b.accent) || user.settings?.accent || '#5b8cff',
    logoUrl: str(b.logoUrl),
    tagline: str(b.tagline),
    contactEmail: str(b.contactEmail),
  };

  saveUser(user);
  res.redirect('/dashboard/settings?saved=1');
});

export default router;
