import express from 'express';
import { getDb } from '../../plugins/mongo.js';

const router = express.Router();

const SECTIONS = {
  hero: ['hero_eyebrow', 'hero_heading', 'hero_heading_em', 'hero_sub', 'hero_badge'],
  services: ['services_label', 'services_heading', 'services_heading_em', 'services_sub',
             'service1_title', 'service1_desc',
             'service2_title', 'service2_desc',
             'service3_title', 'service3_desc'],
  about: ['about_quote', 'about_desc', 'about_sig'],
  process: ['process_label', 'process_heading', 'process_heading_em'],
  contact: ['contact_sub', 'contact_location', 'contact_serving'],
};

router.get('/', async (req, res) => {
  const db = getDb();
  const rawCopy = await db.collection('w2_copy').find({}).toArray();
  const copy = {};
  for (const item of rawCopy) copy[item.key] = item.value;
  res.render('admin/copy/index', { user: req.adminUser, copy, sections: SECTIONS, flash: req.query.saved });
});

router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const ops = [];
    for (const [key, value] of Object.entries(req.body)) {
      if (key.startsWith('_')) continue;
      ops.push(
        db.collection('w2_copy').updateOne(
          { key },
          { $set: { key, value: value?.toString().trim(), updatedAt: new Date() } },
          { upsert: true }
        )
      );
    }
    await Promise.all(ops);
    res.redirect('/admin/copy?saved=1');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/copy?error=1');
  }
});

export default router;
