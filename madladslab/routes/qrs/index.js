import express from "express"
const router = express.Router()
import qrcode from 'qrcode'
import chalk from "chalk"
import QRCode from '../../api/v1/models/qrs/QRCode.js'
import QRScan from '../../api/v1/models/qrs/QRScan.js'

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/auth?redirect=/qrs');
  }
  next();
};

// ==================== Views ====================

// GET /qrs - Dashboard
router.get("/", requireAuth, async (req, res) => {
  try {
    console.log("QR Code Dashboard")
    const user = req.user;

    // Get user's QR codes
    const qrCodes = await QRCode.find({ createdBy: user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Get stats with defaults
    const stats = {
      total: await QRCode.countDocuments({ createdBy: user._id }) || 0,
      active: await QRCode.countDocuments({ createdBy: user._id, status: 'active' }) || 0,
      totalScans: qrCodes.reduce((sum, qr) => sum + (qr.stats?.totalScans || 0), 0) || 0
    };

    res.render('qrs/index', {
      title: 'QR Code Manager',
      user,
      qrCodes: qrCodes || [],
      stats
    });
  } catch (error) {
    console.error('Error loading QRS dashboard:', error);
    // Send error page with safe defaults
    res.render('qrs/index', {
      title: 'QR Code Manager',
      user: req.user,
      qrCodes: [],
      stats: { total: 0, active: 0, totalScans: 0 }
    });
  }
});

// ==================== Legacy QR Generation (NO AUTH) ====================
// These must come before /:id route to avoid catching them

// GET /qrs/qr.png - Legacy quick QR generator (PNG)
router.get('/qr.png', async (req, res) => {
  try {
    const { text = '', size = 256, margin = 1 } = req.query;
    const buf = await qrcode.toBuffer(String(text), {
      type: 'png',
      width: +size,
      margin: +margin
    });
    res.type('png').send(buf);
  } catch (e) {
    console.error('QR PNG generation error:', e);
    res.sendStatus(400);
  }
});

// GET /qrs/qr.svg - Legacy quick QR generator (SVG)
router.get('/qr.svg', async (req, res) => {
  try {
    const { text = '', size = 256, margin = 1 } = req.query;
    const svg = await qrcode.toString(String(text), {
      type: 'svg',
      width: +size,
      margin: +margin
    });
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    console.error('QR SVG generation error:', e);
    res.sendStatus(400);
  }
});

// ==================== Authenticated Routes ====================

// GET /qrs/create - Create new QR code form
router.get("/create", requireAuth, (req, res) => {
  res.render('qrs/create', {
    title: 'Create QR Code',
    user: req.user
  });
});

// GET /qrs/:id/analytics - Analytics page (must come before /:id)
router.get("/:id/analytics", requireAuth, async (req, res) => {
  try {
    const qrCode = await QRCode.findOne({
      _id: req.params.id,
      createdBy: req.user._id
    });

    if (!qrCode) {
      return res.status(404).send('QR code not found');
    }

    res.render('qrs/analytics', {
      title: `Analytics - ${qrCode.name}`,
      user: req.user,
      qrCode
    });
  } catch (error) {
    console.error('Error loading analytics:', error);
    res.status(500).send('Error loading analytics');
  }
});

// GET /qrs/:id - View single QR code details (must be last!)
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const qrCode = await QRCode.findOne({
      _id: req.params.id,
      createdBy: req.user._id
    });

    if (!qrCode) {
      return res.status(404).send('QR code not found');
    }

    // Get recent scans
    const recentScans = await QRScan.find({ qrCode: qrCode._id })
      .sort({ scannedAt: -1 })
      .limit(20)
      .lean();

    res.render('qrs/detail', {
      title: qrCode.name,
      user: req.user,
      qrCode,
      recentScans
    });
  } catch (error) {
    console.error('Error loading QR code:', error);
    res.status(500).send('Error loading QR code');
  }
});

export default router