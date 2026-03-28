const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const User = require('../../models/User');
const Brand = require('../../models/Brand');
const router = express.Router();

// Multer — memory storage for OCR (no need to persist the image)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /admin/roster — scanner page
router.get('/', async (req, res) => {
  const brands = await Brand.find({ active: true }).select('name').lean();
  const brandId = req.query.brandId || '';
  let users = [];
  if (brandId) {
    users = await User.find({ brand: brandId, role: 'user' }).select('displayName posPin').sort({ displayName: 1 }).lean();
  }
  res.render('admin/roster/index', {
    title: res.locals.t('nav.roster') || 'Roster Scanner',
    brands,
    brandId,
    users,
    ocrResult: null
  });
});

// POST /admin/roster/scan — process image with OCR
router.post('/scan', upload.single('roster'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

    const lang = req.body.ocrLang || 'eng';
    const { data } = await Tesseract.recognize(req.file.buffer, lang, {
      logger: m => {} // silent
    });

    // Raw text + lines
    const rawText = data.text;
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Try to match lines against known staff for this brand
    const brandId = req.body.brandId;
    let staffMatches = [];
    if (brandId) {
      const users = await User.find({ brand: brandId, role: 'user' }).select('displayName posPin firstName lastName').lean();
      staffMatches = matchStaffToLines(lines, users);
    }

    res.json({
      success: true,
      rawText,
      lines,
      staffMatches,
      confidence: Math.round(data.confidence)
    });
  } catch (err) {
    console.error('[OCR error]', err);
    res.status(500).json({ success: false, message: 'OCR processing failed' });
  }
});

// POST /admin/roster/save — save parsed roster to Shift(s)
router.post('/save', async (req, res) => {
  try {
    const { brandId, entries } = req.body;
    if (!brandId || !entries || !entries.length) {
      return res.status(400).json({ success: false, message: 'No data to save' });
    }

    const Shift = require('../../models/Shift');
    const today = new Date().toISOString().slice(0, 10);

    // Group entries by shiftTime
    const byShift = {};
    entries.forEach(e => {
      const st = e.shiftTime || 'open';
      if (!byShift[st]) byShift[st] = [];
      byShift[st].push(e);
    });

    const created = [];
    for (const [shiftTime, crew] of Object.entries(byShift)) {
      // Find or create the shift
      let shift = await Shift.findOne({ brand: brandId, date: today, shiftTime });
      if (!shift) {
        shift = await Shift.create({
          brand: brandId,
          date: today,
          shiftTime,
          status: 'draft',
          createdBy: req.user._id
        });
      }

      // Add crew members
      for (const e of crew) {
        if (!e.displayName) continue;
        const existing = shift.crew.find(c => c.posPin === e.posPin && e.posPin);
        if (!existing) {
          shift.crew.push({
            user: e.userId || undefined,
            displayName: e.displayName,
            posPin: e.posPin || '',
            role: e.role || '',
            station: '',
            present: false
          });
        }
      }
      await shift.save();
      created.push(shiftTime);
    }

    res.json({ success: true, message: `Roster loaded into ${created.join(', ')} shift(s)`, redirect: `/admin/shifts/command?brandId=${brandId}` });
  } catch (err) {
    console.error('[roster save error]', err);
    res.status(500).json({ success: false, message: 'Save failed' });
  }
});

// Fuzzy match OCR lines to known staff
function matchStaffToLines(lines, users) {
  const results = [];
  const usedUsers = new Set();

  for (const line of lines) {
    const lower = line.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const u of users) {
      if (usedUsers.has(u._id.toString())) continue;
      const names = [
        u.displayName?.toLowerCase(),
        u.firstName?.toLowerCase(),
        u.lastName?.toLowerCase(),
        `${u.firstName} ${u.lastName}`.toLowerCase().trim()
      ].filter(Boolean);

      for (const name of names) {
        // Check if name appears in the line
        if (lower.includes(name) && name.length > 2) {
          const score = name.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = u;
          }
        }
      }

      // Also check PIN
      if (u.posPin && lower.includes(u.posPin)) {
        if (u.posPin.length > bestScore) {
          bestScore = u.posPin.length;
          bestMatch = u;
        }
      }
    }

    // Try to extract shift time from the line
    let shiftTime = '';
    if (/open|am|morning|apert/i.test(line)) shiftTime = 'open';
    else if (/mid|swing/i.test(line)) shiftTime = 'mid';
    else if (/close|pm|night|evening|cierr/i.test(line)) shiftTime = 'close';

    // Try to extract a role/position
    let role = '';
    if (/server|mesero|waiter/i.test(line)) role = 'server';
    else if (/bar|cantina/i.test(line)) role = 'bartender';
    else if (/host|anfitr/i.test(line)) role = 'host';
    else if (/cook|cocin|prep|line/i.test(line)) role = 'cook';
    else if (/bus|limpi/i.test(line)) role = 'busser';
    else if (/dish|lava/i.test(line)) role = 'dishwasher';
    else if (/manager|gerente|mgr/i.test(line)) role = 'manager';
    else if (/expo/i.test(line)) role = 'expo';

    results.push({
      line,
      matched: !!bestMatch,
      userId: bestMatch?._id || null,
      displayName: bestMatch?.displayName || '',
      posPin: bestMatch?.posPin || '',
      shiftTime,
      role
    });

    if (bestMatch) usedUsers.add(bestMatch._id.toString());
  }

  return results;
}

module.exports = router;
