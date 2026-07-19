import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { permissionCatalog, permissionKeys } from '../../plugins/featureRegistry.js';

const router = express.Router();

const oid = (v) => { try { return new ObjectId(v); } catch { return null; } };
const effectiveRole = (u) => (u.isAdmin ? 'admin' : (u.role || 'none'));

// ── User list (with filters) ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const [allUsers, clients, roles] = await Promise.all([
      db.collection('users').find({}).sort({ _id: -1 }).toArray(),
      db.collection('clients').find({}, { projection: { name: 1, email: 1, company: 1 } }).toArray(),
      db.collection('roles').find({}).sort({ name: 1 }).toArray(),
    ]);

    // Header stats (computed from the FULL set, before filtering).
    const stats = {
      total: allUsers.length,
      admins: allUsers.filter((u) => effectiveRole(u) === 'admin').length,
      restricted: allUsers.filter((u) => Array.isArray(u.permissions) && u.permissions.length).length,
      clients: allUsers.filter((u) => effectiveRole(u) === 'client').length,
    };

    // Filters
    const q = (req.query.q || '').trim().toLowerCase();
    const roleFilter = (req.query.role || '').trim();       // admin|client|collaborator|none
    const croleFilter = (req.query.crole || '').trim();      // custom roleId
    const accessFilter = (req.query.access || '').trim();    // full|restricted

    let users = allUsers;
    if (q) users = users.filter((u) => `${u.displayName || ''} ${u.email || ''}`.toLowerCase().includes(q));
    if (roleFilter) users = users.filter((u) => effectiveRole(u) === roleFilter);
    if (croleFilter) users = users.filter((u) => String(u.roleId || '') === croleFilter);
    if (accessFilter === 'full') users = users.filter((u) => !(Array.isArray(u.permissions) && u.permissions.length));
    if (accessFilter === 'restricted') users = users.filter((u) => Array.isArray(u.permissions) && u.permissions.length);

    const roleMap = {};
    for (const r of roles) roleMap[String(r._id)] = { name: r.name, color: r.color };

    res.render('admin/users/index', {
      user: req.adminUser,
      users, clients, roles, roleMap, stats,
      totalUsers: allUsers.length,
      filters: { q: req.query.q || '', role: roleFilter, crole: croleFilter, access: accessFilter },
      permCatalog: permissionCatalog(),
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[admin/users] error:', err);
    res.status(500).send('Error loading users.');
  }
});

// ── Update user role (system role) ────────────────────────────────────────────
router.post('/:id/role', async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'client', 'collaborator'];
  if (!validRoles.includes(role)) return res.redirect('/admin/users?error=Invalid role');

  try {
    const db = req.db;
    const userId = new ObjectId(req.params.id);
    const updates = { role };
    // Admin-panel access is gated on isAdmin. A collaborator is a *restricted*
    // admin scoped by their permissions array; only clients are portal-only.
    updates.isAdmin = role === 'admin' || role === 'collaborator';
    await db.collection('users').updateOne({ _id: userId }, { $set: updates });
    res.redirect('/admin/users?success=Role updated');
  } catch (err) {
    console.error('[admin/users/role] error:', err);
    res.redirect('/admin/users?error=Failed to update role');
  }
});

// ── Apply a custom role bundle to a user ──────────────────────────────────────
// Snapshots the role's permission set onto the user and stamps roleId/roleName.
// Empty roleId detaches from any role (permissions left as-is → "Custom").
router.post('/:id/apply-role', async (req, res) => {
  const userId = oid(req.params.id);
  if (!userId) return res.redirect('/admin/users?error=Bad user');
  try {
    const db = req.db;
    const roleId = (req.body.roleId || '').trim();
    if (!roleId) {
      await db.collection('users').updateOne({ _id: userId }, { $unset: { roleId: '', roleName: '' } });
      return res.redirect('/admin/users?success=Detached from role (permissions kept)');
    }
    const role = await db.collection('roles').findOne({ _id: oid(roleId) });
    if (!role) return res.redirect('/admin/users?error=Role not found');
    // A collaborator/admin must be able to enter the panel to use the grants.
    const setAdmin = {};
    const u = await db.collection('users').findOne({ _id: userId }, { projection: { isAdmin: 1, role: 1 } });
    if (!u?.isAdmin) { setAdmin.isAdmin = true; if (!u?.role || u.role === 'client') setAdmin.role = 'collaborator'; }
    await db.collection('users').updateOne(
      { _id: userId },
      { $set: { permissions: Array.isArray(role.permissions) ? role.permissions : [], roleId: String(role._id), roleName: role.name, ...setAdmin } },
    );
    res.redirect('/admin/users?success=' + encodeURIComponent(`Applied role “${role.name}”`));
  } catch (err) {
    console.error('[admin/users/apply-role] error:', err);
    res.redirect('/admin/users?error=Failed to apply role');
  }
});

// ── Link user to client ───────────────────────────────────────────────────────
router.post('/:id/link-client', async (req, res) => {
  const { clientId } = req.body;
  try {
    const db = req.db;
    const userId = new ObjectId(req.params.id);
    if (clientId) {
      await db.collection('users').updateOne({ _id: userId }, { $set: { clientId } });
      await db.collection('clients').updateOne(
        { _id: new ObjectId(clientId) },
        { $set: { userId: req.params.id, updatedAt: new Date() } },
      );
    } else {
      const user = await db.collection('users').findOne({ _id: userId });
      if (user?.clientId) {
        try {
          await db.collection('clients').updateOne(
            { _id: new ObjectId(user.clientId) }, { $unset: { userId: '' } },
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

// ── Update permissions (manual) — going custom detaches from any role ─────────
router.post('/:id/permissions', async (req, res) => {
  const raw = Array.isArray(req.body.permissions) ? req.body.permissions : (req.body.permissions ? [req.body.permissions] : []);
  const valid = new Set(permissionKeys());
  const perms = [...new Set(raw.filter((p) => valid.has(p)))];
  try {
    const db = req.db;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { permissions: perms }, $unset: { roleId: '', roleName: '' } },
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
    if (req.params.id === req.adminUser.id) {
      return res.redirect('/admin/users?error=Cannot delete your own account');
    }
    const user = await db.collection('users').findOne({ _id: userId });
    if (user?.clientId) {
      try {
        await db.collection('clients').updateOne(
          { _id: new ObjectId(user.clientId) }, { $unset: { userId: '' } },
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
