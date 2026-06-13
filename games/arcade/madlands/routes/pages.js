/**
 * Page routes. For the bones there is exactly one view: the blank hex map.
 * The admin builder mounts here later (gated on res.locals.currentUser.canAdmin).
 */
import express from 'express';
const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', {
    title: 'Madlands',
    currentUser: res.locals.currentUser,
    boardRadius: 6,
  });
});

// Lightweight identity probe for the client action bar.
router.get('/whoami', (req, res) => {
  res.json({ user: req.session?.user || null });
});

export default router;
