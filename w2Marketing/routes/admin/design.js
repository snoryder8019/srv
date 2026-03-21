import express from 'express';
import { getDb } from '../../plugins/mongo.js';

const router = express.Router();

export const DESIGN_DEFAULTS = {
  color_primary:       '#1C2B4A',
  color_primary_deep:  '#0F1B30',
  color_primary_mid:   '#2E4270',
  color_accent:        '#C9A848',
  color_accent_light:  '#E8D08A',
  color_bg:            '#F5F3EF',
  font_heading:        'Cormorant Garamond',
  font_body:           'Jost',
  vis_hero:            'true',
  vis_services:        'true',
  vis_portfolio:       'true',
  vis_about:           'true',
  vis_process:         'true',
  vis_reviews:         'true',
  vis_contact:         'true',
  vis_blog:            'false',
  agent_name:          'W2 Assistant',
  agent_greeting:      'Hi! I can write blog posts, update site copy, or build new sections. What would you like to create?',
};

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const rawDesign = await db.collection('w2_design').find({}).toArray();
    const design = { ...DESIGN_DEFAULTS };
    for (const item of rawDesign) design[item.key] = item.value;
    res.render('admin/design/index', {
      user: req.adminUser, page: 'design', title: 'Design & Settings',
      design, saved: req.query.saved === '1', error: req.query.error === '1',
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const ops = Object.keys(DESIGN_DEFAULTS).map(key => {
      const value = key.startsWith('vis_')
        ? (req.body[key] === 'on' ? 'true' : 'false')
        : (req.body[key] || DESIGN_DEFAULTS[key]);
      return db.collection('w2_design').updateOne(
        { key },
        { $set: { key, value, updatedAt: new Date() } },
        { upsert: true }
      );
    });
    await Promise.all(ops);
    res.redirect('/admin/design?saved=1');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/design?error=1');
  }
});

export default router;
