import express from 'express';
import plugins from '../plugins/index.js'
import api from '../api/index.js';
import admin from './admin/index.js';
import chalk from 'chalk';
const router = express.Router();
import fetch from 'node-fetch';
import { load } from 'cheerio';
import { getAllNews } from '../services/newsScrapers.js';

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
  try {
    // Get top headlines from all sources
    const allNews = await getAllNews();
    const user = req.user;

    // Get just the top headline from each source
    const topHeadlines = {
      cnn: allNews.cnn[0] || null,
      fox: allNews.fox[0] || null,
      bbc: allNews.bbc[0] || null,
      ap: allNews.ap[0] || null,
      reuters: allNews.reuters[0] || null
    };

    res.render('index', { title: 'Some News Article', user, topHeadlines, allNews });
  } catch (error) {
    console.error('Error fetching news:', error);
    res.render('index', { title: 'Some News Article', user: req.user, topHeadlines: {}, allNews: {} });
  }
});

router.get('/news', async (req, res) => {
  try {
    const news = await getAllNews();
    const user = req.user;
    res.render('news', { title: 'Multi-Source News', user, news });
  } catch (error) {
    console.error('Error fetching news:', error);
    res.render('error', { error: { message: 'Failed to fetch news' } });
  }
});

router.use('/api', api)
router.use('/admin', admin)
router.use('/',plugins)
export default router;
