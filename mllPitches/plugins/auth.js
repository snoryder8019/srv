import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'snoryder8019@gmail.com';

export function isOAuthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

if (isOAuthConfigured()) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        if (email !== ADMIN_EMAIL.toLowerCase()) {
          return done(null, false, { message: 'not authorized' });
        }
        return done(null, { id: profile.id, email, name: profile.displayName });
      }
    )
  );
}

passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));

export default passport;
