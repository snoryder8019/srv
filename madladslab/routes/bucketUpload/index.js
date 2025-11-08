import express from 'express';
const router = express.Router();

/**
 * Bucket Upload Routes
 * Standalone tool for managing Linode Object Storage
 */

// Middleware to ensure authentication
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth');
}

/**
 * GET /bucketUpload
 * Main bucket management interface
 */
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('bucketUpload/index', {
    title: 'Bucket Upload Manager',
    user: req.user
  });
});

/**
 * GET /bucketUpload/trim
 * Video trimming tool
 */
router.get('/trim', ensureAuthenticated, (req, res) => {
  res.render('bucketUpload/trim', {
    title: 'Video Trimmer',
    user: req.user
  });
});

/**
 * GET /bucketUpload/split
 * Video splitting tool for large files
 */
router.get('/split', ensureAuthenticated, (req, res) => {
  res.render('bucketUpload/split', {
    title: 'Video Splitter',
    user: req.user
  });
});

export default router;
