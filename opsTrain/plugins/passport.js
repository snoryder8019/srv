const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/User');

// Serialize / Deserialize
passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Google OAuth — for brandAdmin+ roles
passport.use(new GoogleStrategy({
  clientID: process.env.GGLCID,
  clientSecret: process.env.GGLSEC,
  callbackURL: process.env.CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id });
    if (!user) {
      user = await User.findOne({ email: profile.emails[0].value });
    }
    if (user) {
      if (!user.googleId) {
        user.googleId = profile.id;
        await user.save();
      }
      return done(null, user);
    }
    // New Google user — default to visitor until assigned a role
    user = await User.create({
      googleId: profile.id,
      email: profile.emails[0].value,
      displayName: profile.displayName,
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || '',
      avatar: profile.photos?.[0]?.value || '',
      role: 'visitor',
      provider: 'google'
    });
    done(null, user);
  } catch (err) {
    done(err);
  }
}));

// Local strategy — POS pin login for shift users
passport.use('pos-pin', new LocalStrategy({
  usernameField: 'pin',
  passwordField: 'pin',
  passReqToCallback: true
}, async (req, pin, _pin2, done) => {
  try {
    const brandId = req.body.brandId || req.query.brandId;
    const user = await User.findOne({ posPin: pin, brand: brandId, role: 'user' });
    if (!user) return done(null, false, { message: 'Invalid PIN' });
    done(null, user);
  } catch (err) {
    done(err);
  }
}));
