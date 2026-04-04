import express from 'express';
import { ObjectId } from 'mongodb';
import { execSync } from 'child_process';
import { getDb } from '../../plugins/mongo.js';
import { config } from '../../config/config.js';

const router = express.Router();

// Admin pages that have tutorials
const TUTORIAL_PAGES = [
  { key: 'dashboard',        label: 'Dashboard',        desc: 'Main dashboard overview' },
  { key: 'blog',             label: 'Blog',             desc: 'Blog post management' },
  { key: 'pages',            label: 'Pages',            desc: 'Dynamic page management' },
  { key: 'sections',         label: 'Sections',         desc: 'Section management' },
  { key: 'copy',             label: 'Copy',             desc: 'Site copy editor' },
  { key: 'design',           label: 'Design',           desc: 'Design tokens & themes' },
  { key: 'portfolio',        label: 'Portfolio',        desc: 'Portfolio management' },
  { key: 'assets',           label: 'Assets',           desc: 'Asset management' },
  { key: 'clients',          label: 'Clients',          desc: 'Client management' },
  { key: 'meetings',         label: 'Meetings',         desc: 'Meeting management' },
  { key: 'bookkeeping',      label: 'Bookkeeping',      desc: 'Invoice & payments' },
  { key: 'email-marketing',  label: 'Email Marketing',  desc: 'Campaigns & contacts' },
  { key: 'users',            label: 'Users',            desc: 'User management' },
  { key: 'master-agent',     label: 'Master Agent',     desc: 'AI agent orchestrator' },
];

// ── GET /admin/profile — Render profile page ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.adminUser.id) });
    if (!user) return res.redirect('/admin');

    // Ensure tutorials sub-doc exists
    const tutorials = user.tutorials || { seen: {}, dismissed: {}, autoPlay: true, lastReset: null };

    // Load git commits for What's New
    let whatsNew = [];
    try {
      const gitLog = execSync(
        'git log main --pretty=format:"%H|%h|%s|%ai|%an" -15',
        { encoding: 'utf8', timeout: 5000, cwd: process.cwd() }
      ).trim();
      if (gitLog) {
        for (const line of gitLog.split('\n')) {
          const [hash, short, message, dateStr, author] = line.split('|');
          if (!message) continue;
          const d = new Date(dateStr);
          whatsNew.push({
            short, message, hash,
            date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            version: message.match(/v\s*[\d.]+/i)?.[0]?.trim() || null,
          });
        }
      }
    } catch { /* ignore */ }

    res.render('admin/profile/index', {
      user: req.adminUser,
      dbUser: user,
      tutorials,
      tutorialPages: TUTORIAL_PAGES,
      whatsNew,
      platformEnv: config.NODE_ENV,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[admin/profile] error:', err);
    res.redirect('/admin');
  }
});

// ── POST /admin/profile/update — Update profile preferences ─────────────────
router.post('/update', async (req, res) => {
  try {
    const db = req.db;
    const { displayName, tutorialAutoPlay, tutorialCollapsed } = req.body;

    const updates = {};
    if (displayName && displayName.trim()) {
      updates.displayName = displayName.trim();
    }
    updates['tutorials.autoPlay'] = tutorialAutoPlay === 'on';
    updates['tutorials.collapsed'] = tutorialCollapsed === 'on';

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.adminUser.id) },
      { $set: updates }
    );

    res.redirect('/admin/profile?success=Profile updated');
  } catch (err) {
    console.error('[admin/profile/update] error:', err);
    res.redirect('/admin/profile?error=Failed to update profile');
  }
});

// ── POST /admin/profile/reset-tutorials — Reset all tutorial progress ───────
router.post('/reset-tutorials', async (req, res) => {
  try {
    const db = req.db;

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.adminUser.id) },
      {
        $set: {
          'tutorials.seen': {},
          'tutorials.dismissed': {},
          'tutorials.lastReset': new Date(),
        },
      }
    );

    res.redirect('/admin/profile?success=All tutorials have been reset');
  } catch (err) {
    console.error('[admin/profile/reset-tutorials] error:', err);
    res.redirect('/admin/profile?error=Failed to reset tutorials');
  }
});

// ── POST /admin/profile/reset-tutorial/:page — Reset specific tutorial ──────
router.post('/reset-tutorial/:page', async (req, res) => {
  try {
    const db = req.db;
    const page = req.params.page;

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.adminUser.id) },
      {
        $unset: {
          [`tutorials.seen.${page}`]: '',
          [`tutorials.dismissed.${page}`]: '',
        },
      }
    );

    res.redirect('/admin/profile?success=Tutorial for ' + encodeURIComponent(page) + ' has been reset');
  } catch (err) {
    console.error('[admin/profile/reset-tutorial] error:', err);
    res.redirect('/admin/profile?error=Failed to reset tutorial');
  }
});

// ── POST /admin/profile/complete-tutorial/:page — Mark tutorial complete ─────
router.post('/complete-tutorial/:page', async (req, res) => {
  try {
    const db = req.db;
    const page = req.params.page;

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.adminUser.id) },
      {
        $set: {
          [`tutorials.seen.${page}`]: new Date(),
        },
        $unset: {
          [`tutorials.dismissed.${page}`]: '',
        },
      }
    );

    res.redirect('/admin/profile?success=Tutorial for ' + encodeURIComponent(page) + ' marked complete');
  } catch (err) {
    console.error('[admin/profile/complete-tutorial] error:', err);
    res.redirect('/admin/profile?error=Failed to mark tutorial complete');
  }
});

export default router;
