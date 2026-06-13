import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import express from 'express';
import { getDb } from '../mongo/mongo.js';

export const router = express.Router();

// Configure Local Strategy
passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const db = getDb();
        const user = await db.collection('users').findOne({ email });

        if (!user) {
          return done(null, false, { message: 'Incorrect email or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: 'Incorrect email or password.' });
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Serialize user
passport.serializeUser((user, done) => {
  done(null, user._id.toString());
});

// Deserialize user
passport.deserializeUser(async (id, done) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

export default passport;
