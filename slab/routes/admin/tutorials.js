import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';

const router = express.Router();

// All known tutorial pages — used for progress calculations
const TUTORIAL_PAGES = [
  'dashboard', 'blog', 'blog-form', 'pages', 'pages-form',
  'copy', 'design', 'sections', 'portfolio', 'portfolio-form',
  'clients', 'client-detail', 'assets', 'meetings', 'meeting-detail',
  'bookkeeping', 'email-marketing', 'campaign-detail', 'users',
  'master-agent', 'tickets', 'ticket-detail', 'settings', 'profile',
  'social-generator', 'video-trimmer', 'whats-new',
];

// Default tutorials object for users who don't have one yet
function getDefaults() {
  return { seen: {}, dismissed: {}, autoPlay: true, lastReset: null };
}

// Helper: get user's tutorials field (handles missing/legacy users)
function getTutorials(user) {
  if (!user.tutorials) return getDefaults();
  return {
    seen: user.tutorials.seen || {},
    dismissed: user.tutorials.dismissed || {},
    autoPlay: user.tutorials.autoPlay !== false,
    lastReset: user.tutorials.lastReset || null,
  };
}

// GET /admin/tutorials/status — current user's tutorial state
router.get('/status', async (req, res) => {
  try {
    const db = req.db;
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.adminUser.id) });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, tutorials: getTutorials(user) });
  } catch (err) {
    console.error('[tutorials] status error:', err);
    res.status(500).json({ error: err.message || 'Failed to get tutorial status' });
  }
});

// GET /admin/tutorials/progress — completion stats
router.get('/progress', async (req, res) => {
  try {
    const db = req.db;
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.adminUser.id) });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tutorials = getTutorials(user);
    const total = TUTORIAL_PAGES.length;
    const pages = {};
    let completed = 0;

    for (const page of TUTORIAL_PAGES) {
      const seen = !!tutorials.seen[page];
      const dismissed = !!tutorials.dismissed[page];
      pages[page] = { seen, dismissed };
      if (seen) completed++;
    }

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    res.json({ success: true, total, completed, percentage, pages });
  } catch (err) {
    console.error('[tutorials] progress error:', err);
    res.status(500).json({ error: err.message || 'Failed to get progress' });
  }
});

// POST /admin/tutorials/complete — mark a tutorial as seen
router.post('/complete', express.json(), async (req, res) => {
  try {
    const { page } = req.body;
    if (!page || typeof page !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "page" field' });
    }

    const db = req.db;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.adminUser.id) },
      {
        $set: {
          [`tutorials.seen.${page}`]: true,
          [`tutorials.dismissed.${page}`]: false,
        },
      }
    );

    res.json({ success: true, page, status: 'completed' });
  } catch (err) {
    console.error('[tutorials] complete error:', err);
    res.status(500).json({ error: err.message || 'Failed to mark tutorial complete' });
  }
});

// POST /admin/tutorials/dismiss — dismiss a tutorial
router.post('/dismiss', express.json(), async (req, res) => {
  try {
    const { page } = req.body;
    if (!page || typeof page !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "page" field' });
    }

    const db = req.db;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.adminUser.id) },
      { $set: { [`tutorials.dismissed.${page}`]: true } }
    );

    res.json({ success: true, page, status: 'dismissed' });
  } catch (err) {
    console.error('[tutorials] dismiss error:', err);
    res.status(500).json({ error: err.message || 'Failed to dismiss tutorial' });
  }
});

// POST /admin/tutorials/reset — reset all tutorials or a specific one
router.post('/reset', express.json(), async (req, res) => {
  try {
    const { page } = req.body;
    const db = req.db;
    const userId = new ObjectId(req.adminUser.id);

    if (page && typeof page === 'string') {
      // Reset a specific page
      await db.collection('users').updateOne(
        { _id: userId },
        {
          $unset: {
            [`tutorials.seen.${page}`]: '',
            [`tutorials.dismissed.${page}`]: '',
          },
          $set: { 'tutorials.lastReset': new Date() },
        }
      );
      res.json({ success: true, reset: page });
    } else {
      // Reset all
      await db.collection('users').updateOne(
        { _id: userId },
        {
          $set: {
            'tutorials.seen': {},
            'tutorials.dismissed': {},
            'tutorials.lastReset': new Date(),
          },
        }
      );
      res.json({ success: true, reset: 'all' });
    }
  } catch (err) {
    console.error('[tutorials] reset error:', err);
    res.status(500).json({ error: err.message || 'Failed to reset tutorials' });
  }
});

// PUT /admin/tutorials/preferences — update tutorial preferences
router.put('/preferences', express.json(), async (req, res) => {
  try {
    const { autoPlay } = req.body;
    if (typeof autoPlay !== 'boolean') {
      return res.status(400).json({ error: '"autoPlay" must be a boolean' });
    }

    const db = req.db;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.adminUser.id) },
      { $set: { 'tutorials.autoPlay': autoPlay } }
    );

    res.json({ success: true, autoPlay });
  } catch (err) {
    console.error('[tutorials] preferences error:', err);
    res.status(500).json({ error: err.message || 'Failed to update preferences' });
  }
});

export default router;
