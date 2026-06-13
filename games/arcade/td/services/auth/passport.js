/**
 * Passport configuration - Google OAuth strategy.
 * One job: turn a Google profile into a td User document.
 *
 * Credentials come from config.oauth.google (which falls back to /srv/slab/.env).
 * If credentials are missing, this module exports a no-op that logs a warning -
 * the rest of the app keeps running, just without login.
 */
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../../api/v1/models/User.js';
import config from '../../config/index.js';

let configured = false;

// Privacy: we must NEVER store or surface a user's real name. Google's
// profile.displayName is the real name, so we ignore it entirely and seed a
// neutral screen-name handle the user can change later. Email local-parts can
// also contain a real name (scott.wallace@…), so we don't use those either —
// we generate an anonymous handle.
function safeHandle() {
  const adj = ['Swift', 'Iron', 'Hex', 'Storm', 'Ember', 'Frost', 'Shadow', 'Bright', 'Stone', 'Vapor'];
  const noun = ['Warden', 'Architect', 'Sentinel', 'Ranger', 'Tinker', 'Nomad', 'Glyph', 'Bastion', 'Drifter', 'Spark'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  return a + n + Math.floor(100 + Math.random() * 900);
}

export function configurePassport() {
  if (configured) return passport;

  const { clientId, clientSecret, callbackUrl } = config.oauth.google;
  if (!clientId || !clientSecret) {
    console.warn('[auth] Google OAuth disabled - GGLCID/GGLSEC missing');
    return passport;
  }

  passport.use(new GoogleStrategy({
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: callbackUrl,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      const verified = profile.emails?.[0]?.verified || false;
      if (!email) return done(new Error('Google profile missing email'));

      let user = await User.findOne({ googleId: profile.id });
      if (!user) {
        user = await User.create({
          googleId: profile.id,
          email,
          emailVerified: verified,
          displayName: safeHandle(),   // screen name only — never profile.displayName (real name)
          avatarUrl: profile.photos?.[0]?.value,
          lastLoginAt: new Date(),
          loginCount: 1,
        });
      } else {
        user.lastLoginAt = new Date();
        user.loginCount += 1;
        if (!user.avatarUrl && profile.photos?.[0]?.value) user.avatarUrl = profile.photos[0].value;
        await user.save();
      }

      if (user.status !== 'active') {
        return done(null, false, { message: `Account ${user.status}` });
      }

      done(null, user);
    } catch (err) {
      done(err);
    }
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  configured = true;
  console.log(`[auth] Google OAuth ready - callback: ${callbackUrl}`);
  return passport;
}

export function isOAuthEnabled() {
  return Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret);
}

export default passport;
