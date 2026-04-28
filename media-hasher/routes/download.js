// Download — gated by an active license. Mints a short-lived signed Linode URL.
import express from 'express';
import { getDb } from '../plugins/mongo.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { listInstallers, presignInstaller } from '../plugins/storage.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const license = await db.collection('licenses').findOne({
      $or: [{ userId: req.user._id }, { email: req.user.email }],
      status: 'active',
    });
    if (!license) return res.redirect('/pricing?nolicense=1');

    let installers = [];
    try {
      installers = await listInstallers();
    } catch (e) {
      console.error('[download] listInstallers failed:', e.message);
    }

    res.render('download', {
      user: req.user,
      license,
      installers,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/file', requireAuth, async (req, res, next) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).send('Missing key');

    const license = await getDb().collection('licenses').findOne({
      $or: [{ userId: req.user._id }, { email: req.user.email }],
      status: 'active',
    });
    if (!license) return res.status(403).send('No active license');

    const url = await presignInstaller(key, 60 * 5);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

export default router;
