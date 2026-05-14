/**
 * Page routes - EJS views for game / builder / admin.
 */
import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', { title: 'Towers - Hex TD' });
});

router.get('/play', (req, res) => {
  res.render('game/play', { title: 'Play - Towers' });
});

router.get('/build/tower', (req, res) => {
  res.render('builder/tower', { title: 'Tower Builder' });
});

router.get('/build/map', (req, res) => {
  res.render('builder/map', { title: 'Map Builder' });
});

router.get('/browse', (req, res) => {
  res.render('browse', { title: 'Browse Community' });
});

export default router;
