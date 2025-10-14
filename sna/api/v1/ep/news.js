import express from 'express';
import {
  getAllNews,
  getCNNNews,
  getFoxNews,
  getBBCNews,
  getAPNews,
  getReutersNews
} from '../../../services/newsScrapers.js';

const router = express.Router();

/**
 * GET /api/v1/news
 * Get all news from all sources
 */
router.get('/', async (req, res, next) => {
  try {
    const news = await getAllNews();
    res.json({
      success: true,
      data: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/news/cnn
 * Get CNN news only
 */
router.get('/cnn', async (req, res, next) => {
  try {
    const news = await getCNNNews();
    res.json({
      success: true,
      source: 'CNN',
      data: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/news/fox
 * Get Fox News only
 */
router.get('/fox', async (req, res, next) => {
  try {
    const news = await getFoxNews();
    res.json({
      success: true,
      source: 'Fox News',
      data: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/news/bbc
 * Get BBC news only
 */
router.get('/bbc', async (req, res, next) => {
  try {
    const news = await getBBCNews();
    res.json({
      success: true,
      source: 'BBC',
      data: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/news/ap
 * Get Associated Press news only
 */
router.get('/ap', async (req, res, next) => {
  try {
    const news = await getAPNews();
    res.json({
      success: true,
      source: 'AP News',
      data: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/news/reuters
 * Get Reuters news only
 */
router.get('/reuters', async (req, res, next) => {
  try {
    const news = await getReutersNews();
    res.json({
      success: true,
      source: 'Reuters',
      data: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
