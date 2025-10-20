import express from 'express';
import QRCode from '../models/qrs/QRCode.js';
import QRScan from '../models/qrs/QRScan.js';
import qrcode from 'qrcode';

const router = express.Router();

// Middleware to ensure user is authenticated
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ==================== QR Code CRUD ====================

// GET /api/v1/qrs - List all QR codes for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      status,
      category,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = { createdBy: req.user._id };

    if (status) query.status = status;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
    const skip = (page - 1) * limit;

    const [qrCodes, total] = await Promise.all([
      QRCode.find(query)
        .sort(sort)
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      QRCode.countDocuments(query)
    ]);

    res.json({
      qrCodes,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching QR codes:', error);
    res.status(500).json({ error: 'Failed to fetch QR codes' });
  }
});

// GET /api/v1/qrs/:id - Get single QR code
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const qrCode = await QRCode.findOne({
      _id: req.params.id,
      createdBy: req.user._id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    res.json(qrCode);
  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
  }
});

// POST /api/v1/qrs - Create new QR code
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      name,
      description,
      content,
      contentType = 'url',
      isDynamic = false,
      destinationUrl,
      customization = {},
      category,
      tags = [],
      expiresAt
    } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }

    const qrCodeData = {
      name,
      description,
      content,
      contentType,
      isDynamic,
      destinationUrl: isDynamic ? (destinationUrl || content) : undefined,
      customization: {
        ...QRCode.schema.path('customization').defaultValue,
        ...customization
      },
      category,
      tags,
      expiresAt,
      createdBy: req.user._id
    };

    // Generate short code if dynamic
    if (isDynamic) {
      qrCodeData.shortCode = await QRCode.generateShortCode();
      qrCodeData.shortUrl = `${process.env.BASE_URL || req.protocol + '://' + req.get('host')}/q/${qrCodeData.shortCode}`;
      qrCodeData.content = qrCodeData.shortUrl; // QR code points to short URL
    }

    const qrCode = new QRCode(qrCodeData);
    await qrCode.save();

    res.status(201).json(qrCode);
  } catch (error) {
    console.error('Error creating QR code:', error);
    res.status(500).json({ error: 'Failed to create QR code' });
  }
});

// PUT /api/v1/qrs/:id - Update QR code
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const qrCode = await QRCode.findOne({
      _id: req.params.id,
      createdBy: req.user._id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    const allowedUpdates = [
      'name', 'description', 'destinationUrl', 'customization',
      'category', 'tags', 'status', 'expiresAt'
    ];

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        qrCode[field] = req.body[field];
      }
    });

    await qrCode.save();
    res.json(qrCode);
  } catch (error) {
    console.error('Error updating QR code:', error);
    res.status(500).json({ error: 'Failed to update QR code' });
  }
});

// DELETE /api/v1/qrs/:id - Delete QR code
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const qrCode = await QRCode.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.user._id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    // Optionally delete associated scans
    await QRScan.deleteMany({ qrCode: qrCode._id });

    res.json({ message: 'QR code deleted successfully' });
  } catch (error) {
    console.error('Error deleting QR code:', error);
    res.status(500).json({ error: 'Failed to delete QR code' });
  }
});

// ==================== QR Code Generation ====================

// GET /api/v1/qrs/:id/image - Generate QR code image
router.get('/:id/image', async (req, res) => {
  try {
    const { format = 'png' } = req.query;

    const qrCode = await QRCode.findById(req.params.id);

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    const options = {
      width: qrCode.customization.size,
      margin: qrCode.customization.margin,
      errorCorrectionLevel: qrCode.customization.errorCorrectionLevel,
      color: {
        dark: qrCode.customization.foregroundColor,
        light: qrCode.customization.backgroundColor
      }
    };

    if (format === 'svg') {
      const svg = await qrcode.toString(qrCode.content, {
        ...options,
        type: 'svg'
      });
      res.type('image/svg+xml').send(svg);
    } else if (format === 'png') {
      const buffer = await qrcode.toBuffer(qrCode.content, {
        ...options,
        type: 'png'
      });
      res.type('png').send(buffer);
    } else {
      res.status(400).json({ error: 'Invalid format. Use png or svg' });
    }
  } catch (error) {
    console.error('Error generating QR code image:', error);
    res.status(500).json({ error: 'Failed to generate QR code image' });
  }
});

// ==================== Analytics ====================

// GET /api/v1/qrs/:id/analytics - Get analytics for QR code
router.get('/:id/analytics', requireAuth, async (req, res) => {
  try {
    const qrCode = await QRCode.findOne({
      _id: req.params.id,
      createdBy: req.user._id
    });

    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    const { dateFrom, dateTo } = req.query;

    const stats = await QRScan.getStatsByQRCode(
      qrCode._id,
      dateFrom,
      dateTo
    );

    // Get recent scans
    const recentScans = await QRScan.find({ qrCode: qrCode._id })
      .sort({ scannedAt: -1 })
      .limit(50)
      .lean();

    res.json({
      qrCode: {
        id: qrCode._id,
        name: qrCode.name,
        status: qrCode.status
      },
      stats,
      recentScans
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// GET /api/v1/qrs/analytics/overview - Get overview analytics
router.get('/analytics/overview', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const [totalQRCodes, activeQRCodes, totalScans, qrCodes] = await Promise.all([
      QRCode.countDocuments({ createdBy: userId }),
      QRCode.countDocuments({ createdBy: userId, status: 'active' }),
      QRCode.aggregate([
        { $match: { createdBy: userId } },
        { $group: { _id: null, total: { $sum: '$stats.totalScans' } } }
      ]),
      QRCode.find({ createdBy: userId })
        .select('name stats.totalScans stats.lastScannedAt')
        .sort({ 'stats.totalScans': -1 })
        .limit(5)
        .lean()
    ]);

    res.json({
      totalQRCodes,
      activeQRCodes,
      totalScans: totalScans[0]?.total || 0,
      topQRCodes: qrCodes
    });
  } catch (error) {
    console.error('Error fetching overview:', error);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// ==================== Batch Operations ====================

// POST /api/v1/qrs/batch - Create multiple QR codes
router.post('/batch', requireAuth, async (req, res) => {
  try {
    const { qrCodes } = req.body;

    if (!Array.isArray(qrCodes) || qrCodes.length === 0) {
      return res.status(400).json({ error: 'qrCodes array is required' });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < qrCodes.length; i++) {
      try {
        const data = qrCodes[i];
        const qrCodeData = {
          ...data,
          createdBy: req.user._id,
          customization: {
            ...QRCode.schema.path('customization').defaultValue,
            ...(data.customization || {})
          }
        };

        if (data.isDynamic) {
          qrCodeData.shortCode = await QRCode.generateShortCode();
          qrCodeData.shortUrl = `${process.env.BASE_URL || req.protocol + '://' + req.get('host')}/q/${qrCodeData.shortCode}`;
          qrCodeData.content = qrCodeData.shortUrl;
        }

        const qrCode = new QRCode(qrCodeData);
        await qrCode.save();
        created.push(qrCode);
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    res.status(201).json({
      created: created.length,
      errors: errors.length,
      qrCodes: created,
      errorDetails: errors
    });
  } catch (error) {
    console.error('Error batch creating QR codes:', error);
    res.status(500).json({ error: 'Failed to batch create QR codes' });
  }
});

export default router;
