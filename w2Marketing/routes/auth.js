import express from 'express';
import { ObjectId } from 'mongodb';
import passport from '../plugins/passport.js';
import { getDb } from '../plugins/mongo.js';
import { issueAdminJWT, issuePortalJWT } from '../middleware/jwtAuth.js';

const router = express.Router();

// ── Admin Google OAuth ────────────────────────────────────────────────────────
router.get('/google', (req, res, next) => {
  req.session.authType = 'admin';
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
  })(req, res, next);
});

// ── Client Google OAuth ───────────────────────────────────────────────────────
router.get('/google/client', (req, res, next) => {
  req.session.authType = 'client';
  req.session.linkClientId = req.query.cid || null;
  passport.authenticate('google', {
    scope: ['profile', 'email', 'openid'],
  })(req, res, next);
});

// ── Shared callback — routes based on session authType ────────────────────────
router.get('/google/callback', (req, res, next) => {
  const authType = req.session.authType || 'admin';
  const linkClientId = req.session.linkClientId || null;

  passport.authenticate('google', { failureRedirect: authType === 'client' ? '/onboard?error=oauth' : '/admin/login?error=oauth' }, async (err, user) => {
    // Clean up session flags
    delete req.session.authType;
    delete req.session.linkClientId;

    if (err || !user) {
      return res.redirect(authType === 'client' ? '/onboard?error=oauth' : '/admin/login?error=oauth');
    }

    if (authType === 'client') {
      // ── Client login flow ──
      try {
        const db = getDb();

        // Set role on user if not already set
        const updates = {};
        if (!user.role) updates.role = 'client';

        // Link to client record if cid provided
        if (linkClientId && !user.clientId) {
          try {
            const client = await db.collection('w2_clients').findOne({ _id: new ObjectId(linkClientId) });
            if (client) {
              updates.clientId = linkClientId;
              // Also update client record with the user link
              await db.collection('w2_clients').updateOne(
                { _id: new ObjectId(linkClientId) },
                { $set: { userId: user._id.toString(), updatedAt: new Date() } }
              );
            }
          } catch { /* invalid ObjectId, skip */ }
        }

        // If no cid, try to match by email
        if (!updates.clientId && !user.clientId) {
          const clientByEmail = await db.collection('w2_clients').findOne({ email: user.email.toLowerCase() });
          if (clientByEmail) {
            updates.clientId = clientByEmail._id.toString();
            await db.collection('w2_clients').updateOne(
              { _id: clientByEmail._id },
              { $set: { userId: user._id.toString(), updatedAt: new Date() } }
            );
          }
        }

        if (Object.keys(updates).length) {
          await db.collection('users').updateOne({ _id: user._id }, { $set: updates });
          Object.assign(user, updates);
        }

        issuePortalJWT(user, res);
        // For now redirect to success — client portal comes later
        return res.redirect('/onboard/account-linked');
      } catch (e) {
        console.error('[auth/client] error:', e);
        return res.redirect('/onboard?error=oauth');
      }
    }

    // ── Admin login flow (existing) ──
    if (!user.isW2Admin && !user.isAdmin) {
      return res.redirect('/admin/login?error=unauthorized');
    }

    issueAdminJWT(user, res);
    res.redirect('/admin');
  })(req, res, next);
});

router.get('/logout', (req, res) => {
  res.clearCookie('w2_token');
  res.clearCookie('w2_portal');
  res.redirect('/admin/login');
});

export default router;
