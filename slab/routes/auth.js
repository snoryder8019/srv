import express from 'express';
import { ObjectId } from 'mongodb';
import passport from '../plugins/passport.js';
import { issueAdminJWT, issuePortalJWT } from '../middleware/jwtAuth.js';
import { isSuperAdminEmail, issueSuperAdminJWT } from '../middleware/superadmin.js';

const router = express.Router();

// ── Admin Google OAuth ────────────────────────────────────────────────────────
router.get('/google', (req, res, next) => {
  req.session.authType = 'admin';
  req.session.returnDomain = req.query.return || req.hostname;
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
  })(req, res, next);
});

// ── Client Google OAuth ───────────────────────────────────────────────────────
router.get('/google/client', (req, res, next) => {
  req.session.authType = 'client';
  req.session.linkClientId = req.query.cid || null;
  req.session.returnDomain = req.query.return || req.hostname;
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
  })(req, res, next);
});

// ── Superadmin Google OAuth ─────────────────────────────────────────────────
router.get('/google/superadmin', (req, res, next) => {
  req.session.authType = 'superadmin';
  req.session.returnDomain = req.hostname;
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
  })(req, res, next);
});

// ── Shared callback — all OAuth flows return here ───────────────────────────
router.get('/google/callback', (req, res, next) => {
  const authType = req.session.authType || 'admin';
  const linkClientId = req.session.linkClientId || null;
  const returnDomain = req.session.returnDomain || req.hostname;

  passport.authenticate('google', { failureRedirect: '/admin/login?error=oauth' }, async (err, user) => {
    // Clean up session flags
    delete req.session.authType;
    delete req.session.linkClientId;
    delete req.session.returnDomain;

    if (err || !user) {
      return res.redirect(authType === 'client' ? '/onboard?error=oauth' : '/admin/login?error=oauth');
    }

    // ── Superadmin flow ──
    if (authType === 'superadmin') {
      if (!isSuperAdminEmail(user.email)) {
        return res.redirect('/superadmin/login?error=unauthorized');
      }
      issueSuperAdminJWT(user, res);
      return res.redirect(`https://${returnDomain}/superadmin`);
    }

    // ── Client flow ──
    if (authType === 'client') {
      try {
        const db = req.db;
        if (!db) return res.redirect('/onboard?error=oauth');

        const updates = {};
        if (!user.role) updates.role = 'client';

        if (linkClientId && !user.clientId) {
          try {
            const client = await db.collection('clients').findOne({ _id: new ObjectId(linkClientId) });
            if (client) {
              updates.clientId = linkClientId;
              await db.collection('clients').updateOne(
                { _id: new ObjectId(linkClientId) },
                { $set: { userId: user._id.toString(), updatedAt: new Date() } }
              );
            }
          } catch {}
        }

        if (!updates.clientId && !user.clientId) {
          const clientByEmail = await db.collection('clients').findOne({ email: user.email.toLowerCase() });
          if (clientByEmail) {
            updates.clientId = clientByEmail._id.toString();
            await db.collection('clients').updateOne(
              { _id: clientByEmail._id },
              { $set: { userId: user._id.toString(), updatedAt: new Date() } }
            );
          }
        }

        if (Object.keys(updates).length) {
          await db.collection('users').updateOne({ _id: user._id }, { $set: updates });
        }

        issuePortalJWT(user, res);
        return res.redirect(`https://${returnDomain}/onboard/account-linked`);
      } catch (e) {
        console.error('[auth/client] error:', e);
        return res.redirect('/onboard?error=oauth');
      }
    }

    // ── Admin flow ──
    if (!user.isW2Admin && !user.isAdmin) {
      return res.redirect(`https://${returnDomain}/admin/login?error=unauthorized`);
    }

    issueAdminJWT(user, res);
    res.redirect(`https://${returnDomain}/admin`);
  })(req, res, next);
});

router.get('/logout', (req, res) => {
  res.clearCookie('slab_token');
  res.clearCookie('slab_portal');
  res.clearCookie('slab_super');
  res.redirect('/admin/login');
});

export default router;
