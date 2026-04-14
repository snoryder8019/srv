const { notifyAdmin } = require('/srv/slab/plugins/notify.cjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
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

// Google OAuth — for admin+ roles
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
    // New Google user — default to user until an admin promotes them
    user = await User.create({
      googleId: profile.id,
      email: profile.emails[0].value,
      displayName: profile.displayName,
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || '',
      avatar: profile.photos?.[0]?.value || '',
      role: 'user',
      provider: 'google'
    });
    notifyAdmin({ type: 'opstrain', app: 'opsTrain', email: profile.emails[0].value,
      name: profile.displayName, ip: '',
      data: { Method: 'Google OAuth', Role: 'user (pending promotion)' } }).catch(() => {});
    done(null, user);
  } catch (err) {
    done(err);
  }
}));

// Local strategy — email + password login for manager+ roles
passport.use('local', new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password',
}, async (email, password, done) => {
  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return done(null, false, { message: 'Invalid email or password' });
    if (!user.password) return done(null, false, { message: 'No password set. Sign in with Google or ask your admin.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return done(null, false, { message: 'Invalid email or password' });

    // Must be manager or higher to use the admin login
    const adminRoles = ['superadmin', 'admin', 'manager'];
    if (!adminRoles.includes(user.role)) {
      return done(null, false, { message: 'Your account does not have admin access. Staff use QR + PIN.' });
    }

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
