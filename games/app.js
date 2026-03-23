require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.GAMES_PORT || 3500;
const DB_URL = process.env.DB_URL;
const SESSION_SECRET = process.env.SESHSEC || 'dev-secret';

// --- MongoDB ---
let db;
const client = new MongoClient(DB_URL);
client.connect().then(() => {
  db = client.db(); // uses db from connection string
  app.locals.db = db;
  console.log('[games] MongoDB connected');
}).catch(err => {
  console.error('[games] MongoDB connection failed:', err.message);
  process.exit(1);
});

// --- Passport ---
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const user = await db.collection('users').findOne({ email });
      if (!user) return done(null, false, { message: 'Email not found' });
      const match = await bcrypt.compare(password, user.password || '');
      if (!match) return done(null, false, { message: 'Incorrect password' });
      return done(null, user);
    } catch (e) {
      done(e);
    }
  }
));

// Google OAuth — finds or creates user in the shared madladslab users collection
passport.use(new GoogleStrategy(
  {
    clientID: process.env.GGLCID,
    clientSecret: process.env.GGLSEC,
    callbackURL: 'https://games.madladslab.com/auth/google/callback',
    proxy: true,
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const users = db.collection('users');
      const email = profile.emails[0].value;
      let user = await users.findOne({ email });
      if (!user) {
        const result = await users.insertOne({
          providerID: profile.id,
          provider: 'google',
          email,
          displayName: profile.displayName,
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          password: '',
          isAdmin: false,
          contest: 'player',
          notifications: [],
          images: [],
          subscription: 'free',
        });
        user = await users.findOne({ _id: result.insertedId });
      }
      done(null, user);
    } catch (e) {
      done(e);
    }
  }
));

passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    done(null, user || false);
  } catch (e) {
    done(e);
  }
});

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: DB_URL,
    collectionName: 'sessions',
  }),
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

// Static assets only (not index.html — that's served via authenticated route)
app.use('/static', express.static(__dirname + '/public'));

// --- Routes ---
app.use('/', require('./routes/index'));
app.use('/api', require('./routes/api'));
app.use('/internal', require('./routes/internal'));
app.use('/admin', require('./routes/admin'));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[games] Portal running on port ${PORT}`);
});
