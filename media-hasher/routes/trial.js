// Trial activation — no payment required.
// Issues a 7-day trial license to a logged-in (or email-only) user and emails the key.
import express from 'express';
import { getDb } from '../plugins/mongo.js';
import { issueTrialLicense } from '../plugins/licenseService.js';
import { sendLicenseEmail } from '../plugins/mailer.js';

const router = express.Router();

router.post('/start', async (req, res, next) => {
  try {
    let email = req.user?.email || (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email_required' });

    let userId = req.user?._id || null;
    if (!userId) {
      // Anonymous trial — create a lightweight user record so the license has an owner.
      const users = getDb().collection('users');
      const existing = await users.findOne({ email });
      if (existing) {
        userId = existing._id;
      } else {
        const r = await users.insertOne({
          email,
          provider: 'trial',
          displayName: email.split('@')[0],
          isAdmin: false,
          createdAt: new Date(),
        });
        userId = r.insertedId;
      }
    }

    const license = await issueTrialLicense({ userId, email });

    try {
      await sendLicenseEmail({
        to: email,
        displayName: req.user?.displayName,
        licenseKey: license.key,
        type: 'trial',
        expiresAt: license.trialExpiresAt,
      });
    } catch (e) {
      console.error('[trial] email send failed:', e.message);
    }

    if (req.accepts('html') && !req.xhr) {
      return res.redirect(req.user ? '/account' : `/trial/sent?email=${encodeURIComponent(email)}`);
    }
    res.json({ ok: true, key: license.key, expiresAt: license.trialExpiresAt });
  } catch (err) {
    next(err);
  }
});

router.get('/sent', (req, res) => {
  res.render('trial-sent', { user: req.user || null, email: req.query.email || '' });
});

export default router;
