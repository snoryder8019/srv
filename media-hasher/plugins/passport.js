import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { config } from '../config/config.js';

passport.use(
  new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const user = await getDb().collection('users').findOne({ email });
        if (!user) return done(null, false, { message: 'Email not found' });
        const ok = await bcrypt.compare(password, user.password || '');
        if (!ok) return done(null, false, { message: 'Incorrect password' });
        return done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);

if (config.GGLCID && config.GGLSEC) {
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
          const users = getDb().collection('users');
          const email = profile.emails[0].value;
          let user = await users.findOne({ email });
          if (!user) {
            const result = await users.insertOne({
              providerID: profile.id,
              provider: 'google',
              email,
              displayName: profile.displayName,
              firstName: profile.name?.givenName || '',
              lastName: profile.name?.familyName || '',
              password: '',
              isAdmin: false,
              createdAt: new Date(),
            });
            user = await users.findOne({ _id: result.insertedId });
          }
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

passport.serializeUser((user, done) => done(null, user._id.toString()));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getDb().collection('users').findOne({ _id: new ObjectId(id) });
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

export default passport;
