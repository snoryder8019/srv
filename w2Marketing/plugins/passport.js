import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import { getDb } from './mongo.js';
import { ObjectId } from 'mongodb';
import { config } from '../config/config.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: config.GGLCID,
      clientSecret: config.GGLSEC,
      callbackURL: `${config.DOMAIN}/auth/google/callback`,
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const db = getDb();
        const users = db.collection('users');
        let user = await users.findOne({ email: profile.emails[0].value });

        if (!user) {
          const result = await users.insertOne({
            providerID: profile.id,
            provider: 'google',
            email: profile.emails[0].value,
            displayName: profile.displayName,
            firstName: profile.name.givenName,
            lastName: profile.name.familyName,
            password: '',
            isAdmin: false,
            isCandaceAdmin: false,
            isW2Admin: false,
          });
          user = await users.findOne({ _id: result.insertedId });
        }

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user._id));

passport.deserializeUser(async (id, done) => {
  try {
    const db = getDb();
    const users = db.collection('users');
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

export default passport;
