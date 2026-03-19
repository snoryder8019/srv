import express from 'express';
const router = express.Router();

// Available themes — add new ones here
const THEMES = {
  candace:   'w2marketing/theme-candace',
  w2:        'w2marketing/theme-w2',
  political: 'w2marketing/theme-political',
};

const DEFAULT_THEME = 'candace';

router.get('/', (req, res) => {
  // ?theme= param sets session; session persists across requests
  if (req.query.theme && THEMES[req.query.theme]) {
    req.session.w2Theme = req.query.theme;
  }

  const theme = req.session.w2Theme || DEFAULT_THEME;
  const view  = THEMES[theme] || THEMES[DEFAULT_THEME];

  const titles = {
    candace:   'Candace Wallace Creative — Greeley, CO',
    political: 'Vance Political Strategies — Washington, D.C.',
  };
  res.render(view, {
    title: titles[theme] || 'W2 Marketing — Social Media & Web Design | Greeley, CO',
    activeTheme: theme,
  });
});

export default router;
