import express from 'express';
import passport from './localStrat.js';
import bcrypt from 'bcrypt';
import { getDb } from '../mongo/mongo.js';

export const authRouter = express.Router();

// Login route
authRouter.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (!user) {
      return res.status(401).json({ error: info.message || 'Login failed' });
    }
    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }
      return res.json({
        success: true,
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          hasCompletedWelcome: user.hasCompletedWelcome || false,
          hasCompletedIntro: user.hasCompletedIntro || false
        }
      });
    });
  })(req, res, next);
});

// Register route
authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const db = getDb();
    const existingUser = await db.collection('users').findOne({ email });

    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      email,
      username,
      password: hashedPassword,
      userRole: 'tester', // Default new users to tester
      createdAt: new Date(),
      hasCompletedWelcome: false,
      hasCompletedIntro: false,
    };

    const result = await db.collection('users').insertOne(newUser);

    res.status(201).json({
      success: true,
      user: {
        id: result.insertedId,
        email,
        username
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Logout route
authRouter.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check authentication status
authRouter.get('/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        username: req.user.username,
        hasCompletedWelcome: req.user.hasCompletedWelcome || false,
        hasCompletedIntro: req.user.hasCompletedIntro || false
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Mark welcome as completed
authRouter.post('/complete-welcome', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user._id) },
      { $set: { hasCompletedWelcome: true } }
    );

    // Update the session user object
    req.user.hasCompletedWelcome = true;

    res.json({ success: true });
  } catch (err) {
    console.error('Error completing welcome:', err);
    res.status(500).json({ error: 'Failed to update welcome status' });
  }
});

// Mark intro as completed
authRouter.post('/complete-intro', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user._id) },
      { $set: { hasCompletedIntro: true } }
    );

    // Update the session user object
    req.user.hasCompletedIntro = true;

    res.json({ success: true });
  } catch (err) {
    console.error('Error completing intro:', err);
    res.status(500).json({ error: 'Failed to update intro status' });
  }
});

export default authRouter;
