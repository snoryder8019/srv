const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// ─── Local Strategy ───────────────────────────────────────
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const user = await User.findOne({ email });
      if (!user || !user.password) return done(null, false, { message: 'Invalid credentials' });
      const isMatch = await user.comparePassword(password);
      if (!isMatch) return done(null, false, { message: 'Invalid credentials' });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// ─── Google OAuth Strategy ────────────────────────────────
if (process.env.GGL_CID && process.env.GGL_SEC) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GGL_CID,
      clientSecret: process.env.GGL_SEC,
      callbackURL: '/auth/google/callback'
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists by googleId
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          user.lastLogin = new Date();
          await user.save();
          return done(null, user);
        }

        // Check if user exists by email (link accounts)
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        if (email) {
          user = await User.findOne({ email: email.toLowerCase() });
          if (user) {
            user.googleId = profile.id;
            user.avatar = profile.photos && profile.photos[0] ? profile.photos[0].value : user.avatar;
            user.lastLogin = new Date();
            if (!user.displayName) user.displayName = profile.displayName;
            await user.save();
            return done(null, user);
          }
        }

        // Create new user
        user = await User.create({
          googleId: profile.id,
          email: email,
          displayName: profile.displayName,
          firstName: profile.name ? profile.name.givenName : '',
          lastName: profile.name ? profile.name.familyName : '',
          avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : '',
          lastLogin: new Date()
        });

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));
}

module.exports = passport;
