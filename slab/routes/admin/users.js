import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { permissionCatalog, permissionKeys } from '../../plugins/featureRegistry.js';

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
      permCatalog: permissionCatalog(),
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

    // Admin-panel access is gated purely on isAdmin. A collaborator is a
    // *restricted* admin — they work inside the panel but are scoped down by
    // their `permissions` array (see plugins/featureRegistry.js). Only clients
    // are portal-only. Leaving collaborators at isAdmin:false locked them out
    // entirely, which contradicts assigning them feature permissions.
    updates.isAdmin = role === 'admin' || role === 'collaborator';

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
  const raw = Array.isArray(req.body.permissions) ? req.body.permissions : (req.body.permissions ? [req.body.permissions] : []);
  // Keep only known feature keys so a stale/tampered form can't store junk.
  const valid = new Set(permissionKeys());
  const perms = [...new Set(raw.filter((p) => valid.has(p)))];

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
