import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
  if (req.user) return res.redirect('/calendar');
  res.render('index', { title: 'Family Calendar' });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'Privacy & Terms', updatedAt: '2026-05-07' });
});

router.get('/terms', (req, res) => res.redirect('/privacy#terms'));

router.get('/health', (req, res) => res.json({ ok: true, service: 'familyCalendar' }));

export default router;
