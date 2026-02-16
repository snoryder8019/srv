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

// Local strategy
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

// Google strategy
passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });
      if (user) return done(null, user);

      // Check if email already exists (local account) — link it
      user = await User.findOne({ email: profile.emails[0].value });
      if (user) {
        user.googleId = profile.id;
        user.avatar = profile.photos[0]?.value || user.avatar;
        await user.save();
        return done(null, user);
      }

      // New user
      user = await User.create({
        googleId: profile.id,
        email: profile.emails[0].value,
        displayName: profile.displayName,
        avatar: profile.photos[0]?.value
      });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

module.exports = passport;
