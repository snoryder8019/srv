const router = require('express').Router();
const CalendarSlot = require('../models/CalendarSlot');
const Booking = require('../models/Booking');
const RoofCalculator = require('../models/RoofCalculator');

// @route  GET /api/slots?month=2026-04
router.get('/slots', async (req, res) => {
  try {
    const { month, serviceType } = req.query;
    const query = { isAvailable: true };

    if (month) {
      const start = new Date(`${month}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      query.date = { $gte: start, $lt: end };
    } else {
      query.date = { $gte: new Date() };
    }

    if (serviceType) query.serviceType = serviceType;

    const slots = await CalendarSlot.find(query).sort({ date: 1, startTime: 1 });
    res.json({ success: true, slots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// @route  GET /api/slots/:id
router.get('/slots/:id', async (req, res) => {
  try {
    const slot = await CalendarSlot.findById(req.params.id);
    if (!slot) return res.status(404).json({ success: false, error: 'Slot not found' });
    res.json({ success: true, slot });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// @route  GET /api/roof-calculator
// Returns calculator config for the public landing page
router.get('/roof-calculator', async (req, res) => {
  try {
    const cfg = await RoofCalculator.getConfig();
    res.json({ success: true, calculator: cfg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
