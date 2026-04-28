import express from 'express';
import { getDb } from '../plugins/mongo.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const licenses = await db.collection('licenses')
      .find({ $or: [{ userId: req.user._id }, { email: req.user.email }] })
      .sort({ createdAt: -1 })
      .toArray();

    const purchases = await db.collection('purchases')
      .find({ $or: [{ userId: req.user._id }, { email: req.user.email }] })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    res.render('account', {
      user: req.user,
      licenses,
      purchases,
      welcome: req.query.welcome === '1',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
