const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Ticket = require('../models/Ticket');

function requireInternal(req, res, next) {
  if (req.headers['x-bridge-secret'] === process.env.BRIDGE_SECRET) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// List bih users (no passwords)
router.get('/users', requireInternal, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 }).limit(200).lean();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update bih user permissions/admin flag
router.put('/users/:id/permissions', requireInternal, async (req, res) => {
  try {
    const { permissions, isAdmin } = req.body;
    const update = {};
    if (permissions !== undefined) update.permissions = permissions;
    if (isAdmin !== undefined) update.isAdmin = !!isAdmin;
    await User.findByIdAndUpdate(req.params.id, update);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List bih tickets
router.get('/tickets', requireInternal, async (req, res) => {
  try {
    const tickets = await Ticket.find({}).populate('user', 'displayName email').sort({ createdAt: -1 }).limit(100).lean();
    res.json(tickets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
