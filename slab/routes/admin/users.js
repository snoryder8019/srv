import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';

const router = express.Router();

// ── User list ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const users = await db.collection('users').find({}).sort({ _id: -1 }).toArray();
    const clients = await db.collection('clients').find({}, { projection: { name: 1, email: 1, company: 1 } }).toArray();

    res.render('admin/users/index', {
      user: req.adminUser,
      users,
      clients,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[admin/users] error:', err);
    res.status(500).send('Error loading users.');
  }
});

// ── Update user role ──────────────────────────────────────────────────────────
router.post('/:id/role', async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'client', 'collaborator'];
  if (!validRoles.includes(role)) return res.redirect('/admin/users?error=Invalid role');

  try {
    const db = req.db;
    const userId = new ObjectId(req.params.id);

    const updates = { role };

    // Grant or revoke admin access
    if (role === 'admin') {
      updates.isAdmin = true;
    } else {
      updates.isAdmin = false;
    }

    await db.collection('users').updateOne({ _id: userId }, { $set: updates });
    res.redirect('/admin/users?success=Role updated');
  } catch (err) {
    console.error('[admin/users/role] error:', err);
    res.redirect('/admin/users?error=Failed to update role');
  }
});

// ── Link user to client ───────────────────────────────────────────────────────
router.post('/:id/link-client', async (req, res) => {
  const { clientId } = req.body;

  try {
    const db = req.db;
    const userId = new ObjectId(req.params.id);

    if (clientId) {
      // Link
      await db.collection('users').updateOne({ _id: userId }, { $set: { clientId } });
      // Also set userId on client record
      await db.collection('clients').updateOne(
        { _id: new ObjectId(clientId) },
        { $set: { userId: req.params.id, updatedAt: new Date() } }
      );
    } else {
      // Unlink
      const user = await db.collection('users').findOne({ _id: userId });
      if (user?.clientId) {
        try {
          await db.collection('clients').updateOne(
            { _id: new ObjectId(user.clientId) },
            { $unset: { userId: '' } }
          );
        } catch { /* client may not exist */ }
      }
      await db.collection('users').updateOne({ _id: userId }, { $unset: { clientId: '' } });
    }

    res.redirect('/admin/users?success=Client link updated');
  } catch (err) {
    console.error('[admin/users/link-client] error:', err);
    res.redirect('/admin/users?error=Failed to link client');
  }
});

// ── Update permissions ────────────────────────────────────────────────────────
router.post('/:id/permissions', async (req, res) => {
  const perms = Array.isArray(req.body.permissions) ? req.body.permissions : (req.body.permissions ? [req.body.permissions] : []);

  try {
    const db = req.db;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { permissions: perms } }
    );
    res.redirect('/admin/users?success=Permissions updated');
  } catch (err) {
    console.error('[admin/users/permissions] error:', err);
    res.redirect('/admin/users?error=Failed to update permissions');
  }
});

// ── Delete user ───────────────────────────────────────────────────────────────
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    const userId = new ObjectId(req.params.id);

    // Prevent self-deletion
    if (req.params.id === req.adminUser.id) {
      return res.redirect('/admin/users?error=Cannot delete your own account');
    }

    // Unlink from client if linked
    const user = await db.collection('users').findOne({ _id: userId });
    if (user?.clientId) {
      try {
        await db.collection('clients').updateOne(
          { _id: new ObjectId(user.clientId) },
          { $unset: { userId: '' } }
        );
      } catch { /* ok */ }
    }

    await db.collection('users').deleteOne({ _id: userId });
    res.redirect('/admin/users?success=User deleted');
  } catch (err) {
    console.error('[admin/users/delete] error:', err);
    res.redirect('/admin/users?error=Failed to delete user');
  }
});

export default router;
