import express from "express"
const router = express.Router()
import QRCode from '../../api/v1/models/qrs/QRCode.js'
import QRScan from '../../api/v1/models/qrs/QRScan.js'
import { UAParser } from 'ua-parser-js'
import crypto from 'crypto'

// Helper to get client IP
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress ||
         req.ip;
}

// Helper to generate session fingerprint
function generateFingerprint(req) {
  const components = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
    getClientIp(req)
  ];
  return crypto.createHash('sha256').update(components.join('|')).digest('hex');
}

// Helper to parse device info
function parseDeviceInfo(userAgent) {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  let deviceType = 'unknown';
  if (result.device.type === 'mobile') deviceType = 'mobile';
  else if (result.device.type === 'tablet') deviceType = 'tablet';
  else if (result.browser.name) deviceType = 'desktop';

  return {
    type: deviceType,
    os: result.os.name,
    osVersion: result.os.version,
    browser: result.browser.name,
    browserVersion: result.browser.version,
    userAgent
  };
}

// GET /q/:shortCode - Short URL redirect and scan tracking
router.get("/:shortCode", async (req, res) => {
  try {
    const { shortCode } = req.params;

    // Find QR code by short code
    const qrCode = await QRCode.findOne({ shortCode });

    if (!qrCode) {
      return res.status(404).send('QR code not found');
    }

    // Check if QR code is valid
    if (!qrCode.isValid()) {
      const message = qrCode.status === 'paused' ? 'This QR code is currently paused' :
                      qrCode.status === 'archived' ? 'This QR code has been archived' :
                      qrCode.expiresAt < new Date() ? 'This QR code has expired' :
                      'This QR code is not active';
      return res.status(410).send(message);
    }

    // Get or create session ID
    let sessionId = req.session?.id || req.cookies?.sessionId;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      if (req.session) req.session.id = sessionId;
      res.cookie('sessionId', sessionId, { maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
    }

    // Generate fingerprint
    const fingerprint = generateFingerprint(req);

    // Check if this is a unique scan
    const isUnique = await QRScan.isUniqueScan(qrCode._id, sessionId);

    // Parse device info
    const deviceInfo = parseDeviceInfo(req.headers['user-agent']);

    // Create scan record
    const scanData = {
      qrCode: qrCode._id,
      sessionId,
      fingerprint,
      device: deviceInfo,
      referrer: req.headers.referer || req.headers.referrer,
      location: {
        ip: getClientIp(req)
        // Note: For production, integrate with IP geolocation service
        // like MaxMind GeoIP2 or ipapi.co
      }
    };

    // Extract UTM parameters
    const utmParams = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(param => {
      if (req.query[param]) {
        utmParams[param.replace('utm_', '')] = req.query[param];
      }
    });
    if (Object.keys(utmParams).length > 0) {
      scanData.utm = utmParams;
    }

    // Save scan asynchronously (don't wait for it)
    const scan = new QRScan(scanData);
    scan.save().catch(err => console.error('Error saving scan:', err));

    // Update QR code stats asynchronously
    qrCode.recordScan(isUnique).catch(err => console.error('Error updating stats:', err));

    // Redirect to destination
    const destination = qrCode.destinationUrl || qrCode.content;

    // Ensure destination is a valid URL
    if (destination.startsWith('http://') || destination.startsWith('https://')) {
      res.redirect(destination);
    } else {
      // Assume it's a relative path or add https
      res.redirect(`https://${destination}`);
    }

  } catch (error) {
    console.error('Error processing QR scan:', error);
    res.status(500).send('Error processing request');
  }
});

export default router
