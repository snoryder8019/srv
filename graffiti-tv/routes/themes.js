import express from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(__dirname, '..');

const themeMap = {
  1: path.join(BASE, 'template', 'index.ejs.bak'),
  2: path.join(BASE, 'themes', 'theme2-rave.ejs'),
  3: path.join(BASE, 'themes', 'theme3-retro-diner.ejs'),
  4: path.join(BASE, 'themes', 'theme4-brutalist.ejs'),
  5: path.join(BASE, 'themes', 'theme5-vaporwave.ejs'),
  6: path.join(BASE, 'themes', 'theme6-newsroom.ejs'),
};

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const themePath = themeMap[id];
  if (!themePath) return res.status(404).send('Theme not found');
  try {
    const html = readFileSync(themePath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch(e) {
    res.status(500).send('Theme error: ' + e.message);
  }
});

export default router;
