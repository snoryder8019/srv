import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { encrypt } from './crypto.js';
import { config } from '../config/config.js';

const GOOGLE_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

if (!config.GGLCID || !config.GGLSEC) {
  console.warn('[familyCalendar] Google OAuth not configured — set GGLCID and GGLSEC in .env to enable sign-in');
} else {
  passport.use(new GoogleStrategy(
  {
    clientID: config.GGLCID,
    clientSecret: config.GGLSEC,
    callbackURL: `${config.DOMAIN}/auth/google/callback`,
    proxy: true,
    passReqToCallback: true,
    scope: GOOGLE_SCOPES,
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      const db = getDb();
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('Google profile missing email'));

      const users = db.collection('users');
      let user = await users.findOne({ email });

      if (!user) {
        const result = await users.insertOne({
          providerId: profile.id,
          provider: 'google',
          email,
          displayName: profile.displayName,
          firstName: profile.name?.givenName || '',
          lastName: profile.name?.familyName || '',
          isAdmin: false,
          familyId: null,
          createdAt: new Date(),
        });
        user = await users.findOne({ _id: result.insertedId });
      }

      if (refreshToken && user.familyId) {
        await db.collection('integrations').updateOne(
          { familyId: user.familyId, provider: 'google', userId: user._id },
          {
            $set: {
              refreshToken: encrypt(refreshToken),
              accessTokenHint: accessToken ? accessToken.slice(0, 8) : null,
              scopes: GOOGLE_SCOPES,
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true }
        );
      }

      done(null, user);
    } catch (err) {
      done(err);
    }
  }
  ));
}

passport.serializeUser((user, done) => done(null, user._id.toString()));

passport.deserializeUser(async (id, done) => {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

export default passport;
export { GOOGLE_SCOPES };
