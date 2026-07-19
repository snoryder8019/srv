/**
 * Admin — Roles & Permissions (mounted at /admin/roles)  [adminOnly]
 *
 * A role is a NAMED BUNDLE of feature-permission keys, stored per-tenant in the
 * `roles` collection. Assigning a role to a user snapshots the bundle onto the
 * user's `permissions` array (see routes/admin/users.js apply-role) and stamps
 * `roleId`/`roleName` for reference. Editing a role RE-SYNCS every member, so
 * roles behave "live" without touching the auth-critical load path in
 * middleware/permissions.js (which still just reads user.permissions).
 *
 * Permission keys come from the feature registry (permissionKeys) — the only
 * source of truth — so a role can never grant an unknown/removed capability.
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { permissionCatalog, permissionKeys, NAV_SECTIONS } from '../../plugins/featureRegistry.js';

const router = express.Router();

const oid = (v) => { try { return new ObjectId(v); } catch { return null; } };
const flash = (res, kind, msg) => res.redirect(`/admin/roles?${kind}=${encodeURIComponent(msg)}`);

// Role accent colors (picker in the UI).
const ROLE_COLORS = ['#1C2B4A', '#6B3FA0', '#2B7A5B', '#B45309', '#0E7490', '#9D174D', '#4338CA', '#B91C1C'];

// Starter templates for the "seed" button — all keys validated against the
// registry at insert time, so a renamed feature just drops out silently.
const STARTER_ROLES = [
  { name: 'Content Editor', color: '#2B7A5B', description: 'Website content: pages, blog, portfolio, marketplace, design, assets.',
    permissions: ['pages', 'blog', 'portfolio', 'marketplace', 'design', 'assets'] },
  { name: 'Finance Manager', color: '#B45309', description: 'Full finance suite: bookkeeping, ledger & P&L, calculators, analytics.',
    permissions: ['bookkeeping', 'ledger', 'calculators', 'analytics'] },
  { name: 'CRM / Sales', color: '#0E7490', description: 'Clients & pipeline: inquiries, clients, onboarding, help requests.',
    permissions: ['inquiries', 'clients', 'onboarding', 'tickets'] },
  { name: 'Marketing', color: '#9D174D', description: 'Outbound: email marketing, social, QR codes & card, print studio.',
    permissions: ['email-marketing', 'social', 'qr-codes', 'print-studio'] },
  { name: 'Scheduling', color: '#4338CA', description: 'Meetings, booking and notes.',
    permissions: ['meetings', 'booking', 'notes'] },
];

// Keep only keys that exist as grantable feature permissions today.
function sanitizePerms(raw) {
  const valid = new Set(permissionKeys());
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return [...new Set(arr.filter((p) => valid.has(p)))];
}

// permissionCatalog grouped by section, ordered like the sidebar.
function catalogBySection() {
  const cat = permissionCatalog();
  const groups = NAV_SECTIONS
    .map((section) => ({ section, items: cat.filter((c) => c.section === section) }))
    .filter((g) => g.items.length);
  return groups;
}

async function memberCounts(db) {
  const rows = await db.collection('users').aggregate([
    { $match: { roleId: { $type: 'string' } } },
    { $group: { _id: '$roleId', n: { $sum: 1 } } },
  ]).toArray().catch(() => []);
  const map = {};
  for (const r of rows) map[r._id] = r.n;
  return map;
}

// ── List + builder ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = req.db;
  const [roles, counts] = await Promise.all([
    db.collection('roles').find({}).sort({ name: 1 }).toArray(),
    memberCounts(db),
  ]);
  const editId = req.query.edit || null;
  const editing = editId ? roles.find((r) => String(r._id) === editId) : null;

  res.render('admin/roles/index', {
    user: req.adminUser,
    page: 'roles',
    roles: roles.map((r) => ({ ...r, memberCount: counts[String(r._id)] || 0 })),
    groups: catalogBySection(),
    totalPerms: permissionKeys().length,
    colors: ROLE_COLORS,
    editing,
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const name = (req.body.name || '').trim().slice(0, 60);
    if (!name) return flash(res, 'error', 'Role name is required');
    const color = ROLE_COLORS.includes(req.body.color) ? req.body.color : ROLE_COLORS[0];
    const now = new Date();
    await req.db.collection('roles').insertOne({
      name,
      description: (req.body.description || '').trim().slice(0, 240),
      color,
      permissions: sanitizePerms(req.body.permissions),
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    });
    flash(res, 'success', `Role “${name}” created`);
  } catch (err) {
    console.error('[roles] create error:', err);
    flash(res, 'error', 'Could not create role');
  }
});

// ── Update (+ re-sync members) ────────────────────────────────────────────────
router.post('/:id', async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return flash(res, 'error', 'Bad role id');
  try {
    const db = req.db;
    const name = (req.body.name || '').trim().slice(0, 60);
    if (!name) return flash(res, 'error', 'Role name is required');
    const perms = sanitizePerms(req.body.permissions);
    const color = ROLE_COLORS.includes(req.body.color) ? req.body.color : ROLE_COLORS[0];

    await db.collection('roles').updateOne({ _id: id }, {
      $set: {
        name,
        description: (req.body.description || '').trim().slice(0, 240),
        color, permissions: perms, updatedAt: new Date(),
      },
    });

    // Re-sync every member: their permission snapshot + cached role name.
    const sync = await db.collection('users').updateMany(
      { roleId: String(id) },
      { $set: { permissions: perms, roleName: name } },
    );
    flash(res, 'success', `Role saved${sync.modifiedCount ? ` · ${sync.modifiedCount} member${sync.modifiedCount === 1 ? '' : 's'} updated` : ''}`);
  } catch (err) {
    console.error('[roles] update error:', err);
    flash(res, 'error', 'Could not save role');
  }
});

// ── Delete (detach members, keep their current access) ────────────────────────
router.post('/:id/delete', async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return flash(res, 'error', 'Bad role id');
  try {
    const db = req.db;
    await db.collection('users').updateMany(
      { roleId: String(id) },
      { $unset: { roleId: '', roleName: '' } },
    );
    await db.collection('roles').deleteOne({ _id: id });
    flash(res, 'success', 'Role deleted — members keep their current permissions');
  } catch (err) {
    console.error('[roles] delete error:', err);
    flash(res, 'error', 'Could not delete role');
  }
});

// ── Seed starter roles (only fills gaps; never duplicates by name) ────────────
router.post('/seed', async (req, res) => {
  try {
    const db = req.db;
    const existing = new Set((await db.collection('roles').find({}, { projection: { name: 1 } }).toArray()).map((r) => r.name.toLowerCase()));
    const now = new Date();
    const docs = STARTER_ROLES
      .filter((r) => !existing.has(r.name.toLowerCase()))
      .map((r) => ({ ...r, permissions: sanitizePerms(r.permissions), createdAt: now, updatedAt: now, createdBy: 'starter' }));
    if (!docs.length) return flash(res, 'success', 'Starter roles already present');
    await db.collection('roles').insertMany(docs);
    flash(res, 'success', `Added ${docs.length} starter role${docs.length === 1 ? '' : 's'}`);
  } catch (err) {
    console.error('[roles] seed error:', err);
    flash(res, 'error', 'Could not seed starter roles');
  }
});

export default router;
