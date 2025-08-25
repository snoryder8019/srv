import express from 'express';
import plugins from '../plugins/index.js'
import api from '../api/index.js';
import admin from './admin/index.js';
import chalk from 'chalk';
const router = express.Router();
import fetch from 'node-fetch';
import { load } from 'cheerio';

export const getNews = async () => {
  const res = await fetch('https://cnn.com');
  const html = await res.text();
  const $ = load(html);
  const headlines = [];

  $('a:has(h3), a:has(h2)').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 20) headlines.push(text);
  });

  return [...new Set(headlines)];
};

router.get('/', async (req, res, next) => {
  const headlines = await getNews();
  const user = req.user;
  res.render('index', { title: 'Some News Article', user, headlines });
});
router.use('/api', api)
router.use('/admin', admin)
router.use('/',plugins)
export default router;
