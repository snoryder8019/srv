import express from 'express';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { getDb } from '../plugins/mongo.js';
import { config } from '../config/config.js';
import { meetingAssetUpload } from '../middleware/upload.js';
import { bucketUrl } from '../plugins/s3.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';

const router = express.Router();

/** Load tenant design settings with defaults + contrast vars */
async function loadDesign(db) {
  const design = { ...DESIGN_DEFAULTS };
  try {
    const rows = await db.collection('design').find({}).toArray();
    for (const r of rows) design[r.key] = r.value;
  } catch { /* use defaults */ }
  return enrichDesignContrast(design);
}

// Inject design settings into all meeting views
router.use(async (req, res, next) => {
  res.locals.design = await loadDesign(req.db);
  next();
});

// GET /meeting/:token — public meeting room
router.get('/:token', async (req, res) => {
  try {
    const db = req.db;
    const meeting = await db.collection('meetings').findOne({
      token: req.params.token,
    });

    if (!meeting) {
      return res.status(404).render('meeting-error', {
        message: 'This meeting link is invalid.',
      });
    }

    if (meeting.status === 'closed') {
      return res.status(410).render('meeting-error', {
        message: 'This meeting has been closed by the host.',
      });
    }

    if (meeting.status === 'expired' || (meeting.expiresAt && new Date(meeting.expiresAt) < new Date())) {
      return res.status(410).render('meeting-error', {
        message: 'This meeting link has expired.',
      });
    }

    if (meeting.maxUses && meeting.useCount >= meeting.maxUses) {
      return res.status(410).render('meeting-error', {
        message: 'This meeting link has reached its maximum uses.',
      });
    }

    res.render('meeting', {
      token: meeting.token,
      title: meeting.title,
      domain: req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN,
      tenantDb: req.tenant?.db || '',
    });
  } catch (err) {
    console.error('[meetings] public route error:', err);
    res.status(500).render('meeting-error', {
      message: 'Something went wrong. Please try again.',
    });
  }
});

// GET /meeting/:token/qr — generate QR code as data URL
router.get('/:token/qr', async (req, res) => {
  try {
    const url = `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/meeting/${req.params.token}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#1C2B4A', light: '#F5F3EF' },
    });
    res.json({ qr: qrDataUrl, url });
  } catch (err) {
    console.error('[meetings] QR error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// POST /meeting/:token/invite — send email invite
router.post('/:token/invite', express.json(), async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const db = req.db;
    const meeting = await db.collection('meetings').findOne({
      token: req.params.token,
      status: 'active',
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    if (!config.ZOHO_USER || !config.ZOHO_PASS) {
      return res.status(500).json({ error: 'Email not configured. Add ZOHO_USER and ZOHO_PASS to .env' });
    }

    const meetingUrl = `${req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN}/meeting/${meeting.token}`;

    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: { user: config.ZOHO_USER, pass: config.ZOHO_PASS },
    });

    const greeting = name ? `Hi ${name},` : 'Hi,';

    await transporter.sendMail({
      from: `"${req.tenant?.brand?.name || 'Meeting'}" <${config.ZOHO_USER}>`,
      to: email,
      subject: `You're invited: ${meeting.title}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3EF;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <div style="background:#1C2B4A;border-radius:4px;padding:40px 32px;text-align:center;">
      <h1 style="font-size:24px;font-weight:300;color:#C9A848;margin:0 0 4px;">
        ${meeting.title}
      </h1>
      <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(245,243,239,0.5);margin:0 0 28px;">
        ${req.tenant?.brand?.name || ''}
      </p>
      <p style="font-size:16px;color:#F5F3EF;font-weight:300;line-height:1.6;margin:0 0 28px;">
        ${greeting}<br>You've been invited to a video meeting. Click below to join.
      </p>
      <a href="${meetingUrl}"
         style="display:inline-block;padding:14px 40px;background:#C9A848;color:#0F1B30;
                text-decoration:none;border-radius:2px;font-size:14px;font-weight:600;
                letter-spacing:0.1em;text-transform:uppercase;">
        Join Meeting
      </a>
      <p style="font-size:13px;color:rgba(245,243,239,0.4);margin:28px 0 0;word-break:break-all;">
        ${meetingUrl}
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#6B7380;margin-top:20px;">
      ${req.tenant?.brand?.name || ''} &mdash; ${req.tenant?.brand?.location || ''}
    </p>
  </div>
</body>
</html>`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[meetings] invite email error:', err);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// POST /meeting/:token/upload — upload asset during meeting
router.post('/:token/upload', express.json(), meetingAssetUpload.single('file'), async (req, res) => {
  try {
    const db = req.db;
    const meeting = await db.collection('meetings').findOne({ token: req.params.token, status: 'active' });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const url = file.location || (file.key ? bucketUrl(file.key) : null);
    if (!url) return res.status(500).json({ error: 'Upload failed' });

    const asset = {
      name: file.originalname,
      url,
      size: file.size,
      type: file.mimetype,
      uploadedBy: req.body.displayName || 'Unknown',
      createdAt: new Date(),
    };

    await db.collection('meetings').updateOne(
      { _id: meeting._id },
      { $push: { assets: asset } }
    );

    res.json({ ok: true, asset });
  } catch (err) {
    console.error('[meetings] upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /meeting/:token/data — fetch notes + assets for a meeting
router.get('/:token/data', async (req, res) => {
  try {
    const db = req.db;
    const meeting = await db.collection('meetings').findOne({ token: req.params.token });
    if (!meeting) return res.status(404).json({ error: 'Not found' });
    res.json({
      notes: meeting.notes || [],
      assets: meeting.assets || [],
    });
  } catch (err) {
    console.error('[meetings] data fetch error:', err);
    res.status(500).json({ error: 'Failed to load data' });
  }
});

export default router;
