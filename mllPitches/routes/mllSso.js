// routes/mllSso.js — madladslab SSO endpoints for Left Field users.
// Mounted at /auth alongside the legacy passport (superadmin) router.
import express from 'express';
import { consumeSsoToken, establishSession, clearSession, SLAB_AUTH_URL } from '../plugins/mllAuth.js';

const router = express.Router();

const RETURN_COOKIE = 'mll_returnto';
const IS_PROD = process.env.NODE_ENV === 'production';

function safeReturn(raw) {
  // Only allow same-site absolute paths to prevent open redirects.
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

// Kick off madladslab sign-in. Stash returnTo, then bounce to slab's pitch flow.
router.get('/login', (req, res) => {
  if (req.mllUser) return res.redirect(safeReturn(req.query.returnTo));
  if (req.query.returnTo) {
    res.cookie(RETURN_COOKIE, safeReturn(req.query.returnTo), {
      httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: 5 * 60 * 1000,
    });
  }
  return res.redirect(SLAB_AUTH_URL);
});

// Slab redirects here with a one-time token after Google OAuth.
router.get('/sso', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).render('error', { title: 'Sign-in failed', message: 'Missing SSO token.' });
  try {
    const profile = consumeSsoToken(token);
    establishSession(res, profile);
    const dest = safeReturn(req.cookies?.[RETURN_COOKIE]);
    res.clearCookie(RETURN_COOKIE);
    return res.redirect(dest);
  } catch (err) {
    return res.status(401).render('error', {
      title: 'Sign-in failed',
      message: 'That sign-in link is invalid or expired. Please try again.',
    });
  }
});

router.get('/signout', (req, res) => { clearSession(res); res.redirect('/'); });
router.post('/signout', (req, res) => { clearSession(res); res.redirect('/'); });

export default router;
