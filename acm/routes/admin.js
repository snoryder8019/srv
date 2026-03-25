const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Subscriber = require('../models/Subscriber');
const Campaign = require('../models/Campaign');
const BlogPost = require('../models/BlogPost');
const Promo = require('../models/Promo');
const { PERMISSIONS } = require('../models/Permission');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use('/admin', ensureAuth, ensureAdmin);

// ─── Dashboard ───────────────────────────────────────────────
router.get('/admin/dashboard', async (req, res) => {
  try {
    const [totalUsers, subscribers, campaigns, blogPosts, activePromos] = await Promise.all([
      User.countDocuments(),
      Subscriber.countDocuments({ isSubscribed: true }),
      Campaign.countDocuments(),
      BlogPost.countDocuments(),
      Promo.countDocuments({ isActive: true })
    ]);

    res.render('admin/dashboard', {
      title: 'Dashboard',
      section: 'dashboard',
      stats: { totalUsers, subscribers, campaigns, blogPosts, activePromos }
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

// ─── Users List ──────────────────────────────────────────────
router.get('/admin/users', async (req, res) => {
  try {
    const search = req.query.search || '';
    const roleFilter = req.query.role || '';
    const statusFilter = req.query.status || '';

    let query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }
    if (roleFilter) query.role = roleFilter;
    if (statusFilter === 'active') query.isActive = true;
    if (statusFilter === 'inactive') query.isActive = false;

    const users = await User.find(query).sort({ createdAt: -1 });

    res.render('admin/users', {
      title: 'User Management',
      section: 'users',
      users,
      search,
      roleFilter,
      statusFilter,
      permissions: PERMISSIONS
    });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

// ─── Single User Edit (GET) ─────────────────────────────────
router.get('/admin/users/:id', async (req, res) => {
  try {
    const editUser = await User.findById(req.params.id);
    if (!editUser) {
      return res.status(404).render('error', { message: 'User not found', error: { status: 404 } });
    }
    res.render('admin/user-edit', {
      title: 'Edit User',
      section: 'users',
      editUser,
      permissions: PERMISSIONS,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Admin user-edit error:', err);
    res.status(500).render('error', { message: 'Server error', error: { status: 500 } });
  }
});

// ─── Update User (POST) ─────────────────────────────────────
router.post('/admin/users/:id', async (req, res) => {
  try {
    const { role, isActive, displayName, firstName, lastName, email } = req.body;
    let permissions = req.body.permissions || [];
    if (typeof permissions === 'string') permissions = [permissions];

    // Validate permissions against allowed set
    const allowed = Object.values(PERMISSIONS);
    permissions = permissions.filter(p => allowed.includes(p));

    await User.findByIdAndUpdate(req.params.id, {
      role: role || 'user',
      isActive: isActive === 'true' || isActive === 'on',
      displayName: displayName || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email: email || undefined,
      permissions
    });

    res.redirect('/admin/users/' + req.params.id + '?success=User updated successfully');
  } catch (err) {
    console.error('Admin user update error:', err);
    res.redirect('/admin/users/' + req.params.id + '?error=Failed to update user');
  }
});

// ─── Update User Permissions (POST) ─────────────────────────
router.post('/admin/users/:id/permissions', async (req, res) => {
  try {
    let permissions = req.body.permissions || [];
    if (typeof permissions === 'string') permissions = [permissions];

    const allowed = Object.values(PERMISSIONS);
    permissions = permissions.filter(p => allowed.includes(p));

    await User.findByIdAndUpdate(req.params.id, { permissions });

    res.redirect('/admin/users/' + req.params.id + '?success=Permissions updated');
  } catch (err) {
    console.error('Admin permissions update error:', err);
    res.redirect('/admin/users/' + req.params.id + '?error=Failed to update permissions');
  }
});

// ─── Soft-Delete User (DELETE) ──────────────────────────────
router.delete('/admin/users/:id', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true });
  } catch (err) {
    console.error('Admin user delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to deactivate user' });
  }
});

// ─── Bulk Actions (POST) ────────────────────────────────────
router.post('/admin/users-bulk', async (req, res) => {
  try {
    const { action, userIds } = req.body;
    let ids = userIds;
    if (typeof ids === 'string') {
      try { ids = JSON.parse(ids); } catch (e) { ids = [ids]; }
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.redirect('/admin/users?error=No users selected');
    }

    if (action === 'activate') {
      await User.updateMany({ _id: { $in: ids } }, { isActive: true });
    } else if (action === 'deactivate') {
      await User.updateMany({ _id: { $in: ids } }, { isActive: false });
    }

    res.redirect('/admin/users');
  } catch (err) {
    console.error('Bulk action error:', err);
    res.redirect('/admin/users?error=Bulk action failed');
  }
});

module.exports = router;
