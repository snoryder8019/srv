/**
 * Analytics Middleware
 * Tracks page views, API calls, user actions, and system metrics
 */

import { getDb } from '../plugins/mongo/mongo.js';
import { UAParser } from 'ua-parser-js';

// In-memory cache for recent analytics (reduces DB writes)
const analyticsCache = {
  pageViews: [],
  apiCalls: [],
  errors: [],
  maxCacheSize: 100
};

/**
 * Track page view
 */
export function trackPageView(req, res, next) {
  // Skip tracking for static assets and health checks
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/) ||
      req.path === '/health') {
    return next();
  }

  const parser = new UAParser(req.headers['user-agent']);
  const device = parser.getResult();

  const analyticsData = {
    type: 'pageview',
    timestamp: new Date(),
    path: req.path,
    method: req.method,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer || req.headers.referrer,
    userId: req.user?._id || null,
    username: req.user?.username || null,
    device: {
      browser: device.browser.name,
      browserVersion: device.browser.version,
      os: device.os.name,
      osVersion: device.os.version,
      deviceType: device.device.type || 'desktop'
    },
    query: req.query,
    sessionId: req.session?.id || null
  };

  // Add to cache
  analyticsCache.pageViews.push(analyticsData);

  // Flush to DB if cache is full
  if (analyticsCache.pageViews.length >= analyticsCache.maxCacheSize) {
    flushPageViewsToDb().catch(err => console.error('Analytics flush error:', err));
  }

  next();
}

/**
 * Track API calls with response time
 */
export function trackApiCall(req, res, next) {
  // Only track API routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const startTime = Date.now();
  const originalSend = res.send;

  res.send = function(data) {
    const responseTime = Date.now() - startTime;

    const analyticsData = {
      type: 'api_call',
      timestamp: new Date(),
      path: req.path,
      method: req.method,
      statusCode: res.statusCode,
      responseTime,
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?._id || null,
      username: req.user?.username || null,
      query: req.query,
      body: req.method === 'POST' ? sanitizeBody(req.body) : null,
      success: res.statusCode < 400
    };

    analyticsCache.apiCalls.push(analyticsData);

    if (analyticsCache.apiCalls.length >= analyticsCache.maxCacheSize) {
      flushApiCallsToDb().catch(err => console.error('Analytics flush error:', err));
    }

    return originalSend.call(this, data);
  };

  next();
}

/**
 * Track errors
 */
export function trackError(err, req, res, next) {
  const errorData = {
    type: 'error',
    timestamp: new Date(),
    path: req.path,
    method: req.method,
    error: {
      message: err.message,
      stack: err.stack,
      statusCode: err.status || 500
    },
    ip: req.ip || req.connection.remoteAddress,
    userId: req.user?._id || null,
    username: req.user?.username || null,
    userAgent: req.headers['user-agent']
  };

  analyticsCache.errors.push(errorData);

  if (analyticsCache.errors.length >= 50) {
    flushErrorsToDb().catch(err => console.error('Analytics flush error:', err));
  }

  next(err);
}

/**
 * Custom event tracking (for use in route handlers)
 */
export async function trackEvent(eventName, eventData = {}) {
  const db = getDb();

  await db.collection('analytics_events').insertOne({
    type: 'custom_event',
    eventName,
    eventData,
    timestamp: new Date()
  });
}

/**
 * Flush page views to database
 */
async function flushPageViewsToDb() {
  if (analyticsCache.pageViews.length === 0) return;

  const db = getDb();
  const toFlush = [...analyticsCache.pageViews];
  analyticsCache.pageViews = [];

  try {
    await db.collection('analytics_pageviews').insertMany(toFlush);
  } catch (error) {
    console.error('Failed to flush page views:', error);
    // Put back in cache if failed
    analyticsCache.pageViews = [...toFlush, ...analyticsCache.pageViews];
  }
}

/**
 * Flush API calls to database
 */
async function flushApiCallsToDb() {
  if (analyticsCache.apiCalls.length === 0) return;

  const db = getDb();
  const toFlush = [...analyticsCache.apiCalls];
  analyticsCache.apiCalls = [];

  try {
    await db.collection('analytics_api').insertMany(toFlush);
  } catch (error) {
    console.error('Failed to flush API calls:', error);
    analyticsCache.apiCalls = [...toFlush, ...analyticsCache.apiCalls];
  }
}

/**
 * Flush errors to database
 */
async function flushErrorsToDb() {
  if (analyticsCache.errors.length === 0) return;

  const db = getDb();
  const toFlush = [...analyticsCache.errors];
  analyticsCache.errors = [];

  try {
    await db.collection('analytics_errors').insertMany(toFlush);
  } catch (error) {
    console.error('Failed to flush errors:', error);
    analyticsCache.errors = [...toFlush, ...analyticsCache.errors];
  }
}

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeBody(body) {
  if (!body) return null;

  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '***REDACTED***';
    }
  }

  return sanitized;
}

/**
 * Flush all caches on interval
 */
setInterval(() => {
  Promise.all([
    flushPageViewsToDb(),
    flushApiCallsToDb(),
    flushErrorsToDb()
  ]).catch(err => console.error('Periodic flush error:', err));
}, 30000); // Flush every 30 seconds

/**
 * Flush on process exit
 */
process.on('SIGINT', async () => {
  await Promise.all([
    flushPageViewsToDb(),
    flushApiCallsToDb(),
    flushErrorsToDb()
  ]);
  process.exit(0);
});

export default {
  trackPageView,
  trackApiCall,
  trackError,
  trackEvent
};
