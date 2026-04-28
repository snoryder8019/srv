const router  = require('express').Router();
const Game    = require('../models/Game');

function requireAuth(req, res, next) {
  if (req.user) return next();
  // Pass the current URL as returnTo so auth brings them back here
  res.redirect('/auth/google?returnTo=' + encodeURIComponent(req.originalUrl));
}

// Landing — active games
router.get('/', async (req, res) => {
  try {
    const activeGames = await Game.find({ status: { $in: ['active', 'waiting'] } })
      .sort({ updatedAt: -1 }).limit(8).lean();
    res.render('pages/lobby', { title: 'Triple-Twenty', activeGames });
  } catch (err) {
    res.render('pages/lobby', { title: 'Triple-Twenty', activeGames: [] });
  }
});

// Dashboard — game management (auth required)
router.get('/dashboard', requireAuth, (req, res) => {
  res.render('pages/dashboard', { title: 'My Games' });
});

// Scoreboard (TV)
router.get('/game/:id', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.redirect('/');
    res.render('pages/scoreboard', { title: 'Scoreboard', game });
  } catch (err) { res.redirect('/'); }
});

// Camera / host view
router.get('/camera/:id', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.redirect('/');
    res.render('pages/camera', { title: 'Camera', game });
  } catch (err) { res.redirect('/'); }
});

// Remote player controller
router.get('/remote/:code', (req, res) => {
  res.render('pages/remote', { title: 'Remote Control', inviteCode: req.params.code });
});

// Leaderboard
router.get('/leaderboard', (req, res) => {
  res.render('pages/leaderboard', { title: 'Leaderboard' });
});

// Audience multiplexer: /audience?games=id1,id2[,id3][,id4]
// Shows 1–4 live games simultaneously for bars / league nights.
router.get('/audience', async (req, res) => {
  try {
    const raw = (req.query.games || '').trim();
    const ids = raw.split(',').map(x => x.trim()).filter(Boolean).slice(0, 4);
    if (!ids.length) {
      // Fall back to auto-picking the most recent active/waiting games
      const recent = await Game.find({ status: { $in: ['active', 'waiting'] } })
        .sort({ updatedAt: -1 }).limit(4).lean();
      return res.render('pages/audience', {
        title: 'Audience View',
        games: recent,
        autoSelected: true
      });
    }
    const games = await Game.find({ _id: { $in: ids } }).lean();
    // Preserve the order the user asked for
    const ordered = ids.map(id => games.find(g => String(g._id) === id)).filter(Boolean);
    res.render('pages/audience', { title: 'Audience View', games: ordered, autoSelected: false });
  } catch (err) {
    res.redirect('/');
  }
});

module.exports = router;
