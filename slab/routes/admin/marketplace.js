/**
 * Admin — Marketplace  (mounted at /admin/marketplace)
 *
 * A tenant lists products/services here. Listings render on the tenant's own
 * public site at /marketplace and — when the tenant opts into the sLab Network
 * (Settings → sLab Network) — syndicate to the cross-tenant hub at /network.
 *
 * Images upload to public S3 via the shared marketplaceUpload (multer-s3), the
 * same pattern portfolio uses. Only 'active' listings are ever shown publicly.
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { marketplaceUpload } from '../../middleware/upload.js';
import { s3Client, BUCKET } from '../../plugins/s3.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../../config/config.js';
import {
  MARKET_KINDS, MARKET_STATUSES, MARKET_STATUS_LABELS, PRICE_UNITS,
  uniqueSlug, formatPrice,
} from '../../plugins/marketplaceHelpers.js';

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────
const oid = (v) => { try { return new ObjectId(v); } catch { return null; } };

function priceOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Normalize a contact link: keep internal paths, accept schemes, prepend https
// to bare domains, treat a bare email as mailto:.
function normalizeLink(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (v.startsWith('/')) return v;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|\?|#)/i.test(v)) return `https://${v}`;
  return v;
}

async function deleteS3Key(key) {
  if (!key || !config.LINODE_KEY) return;
  try { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); }
  catch (err) { console.warn('[marketplace] S3 delete warning:', err.message); }
}

// Pull the editable fields off the request body into a listing patch.
function readBody(req) {
  const b = req.body;
  return {
    title: (b.title || '').trim().slice(0, 160),
    kind: MARKET_KINDS.includes(b.kind) ? b.kind : 'product',
    category: (b.category || '').trim().slice(0, 80),
    summary: (b.summary || '').trim().slice(0, 300),
    description: (b.description || '').trim().slice(0, 8000),
    price: priceOrNull(b.price),
    priceUnit: (b.priceUnit || '').trim().slice(0, 24),
    status: MARKET_STATUSES.includes(b.status) ? b.status : 'draft',
    featured: b.featured === 'on' || b.featured === 'true',
    contactUrl: normalizeLink(b.contactUrl),
    contactLabel: (b.contactLabel || '').trim().slice(0, 60),
    location: (b.location || '').trim().slice(0, 120),
    tags: (b.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12),
    // Per-listing syndication opt-out (defaults on). Master switch is Settings.
    networkShare: !(b.networkShare === 'off' || b.networkShare === 'false'),
  };
}

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = req.db;
  const listings = await db.collection('marketplace_listings')
    .find({}).sort({ order: 1, createdAt: -1 }).toArray();

  const counts = { all: listings.length, active: 0, draft: 0, sold: 0, archived: 0 };
  for (const l of listings) counts[l.status] = (counts[l.status] || 0) + 1;

  // Is this tenant syndicating to the network? (read-only hint for the UI)
  const networkOn = req.tenant?.public?.networkOptIn === 'true';
  const networkMarketOn = req.tenant?.public?.networkMarket === 'true';

  res.render('admin/marketplace/index', {
    user: req.adminUser,
    page: 'marketplace',
    listings, counts,
    MARKET_STATUS_LABELS, formatPrice,
    networkOn, networkMarketOn,
    success: req.query.success, error: req.query.error,
  });
});

// ── New / Edit form ───────────────────────────────────────────────────────────
router.get('/new', (req, res) => {
  res.render('admin/marketplace/form', {
    user: req.adminUser, page: 'marketplace',
    listing: null, MARKET_KINDS, MARKET_STATUSES, MARKET_STATUS_LABELS, PRICE_UNITS,
    error: null,
  });
});

router.get('/:id/edit', async (req, res) => {
  const listing = await req.db.collection('marketplace_listings').findOne({ _id: oid(req.params.id) });
  if (!listing) return res.redirect('/admin/marketplace?error=' + encodeURIComponent('Listing not found'));
  res.render('admin/marketplace/form', {
    user: req.adminUser, page: 'marketplace',
    listing, MARKET_KINDS, MARKET_STATUSES, MARKET_STATUS_LABELS, PRICE_UNITS,
    error: null,
  });
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', marketplaceUpload.single('image'), async (req, res) => {
  try {
    const db = req.db;
    const data = readBody(req);
    if (!data.title) throw new Error('Title is required');

    const slug = await uniqueSlug(db, data.title);
    const now = new Date();
    const count = await db.collection('marketplace_listings').countDocuments();

    const doc = {
      ...data, slug,
      imageUrl: req.file?.location || (req.body.imageUrlManual || '').trim(),
      bucketKey: req.file?.key || '',
      order: count,
      createdAt: now, updatedAt: now,
      createdBy: req.adminUser?.displayName || 'admin',
    };
    await db.collection('marketplace_listings').insertOne(doc);
    res.redirect('/admin/marketplace?success=' + encodeURIComponent('Listing created'));
  } catch (err) {
    console.error('[marketplace] create error:', err);
    res.render('admin/marketplace/form', {
      user: req.adminUser, page: 'marketplace',
      listing: null, MARKET_KINDS, MARKET_STATUSES, MARKET_STATUS_LABELS, PRICE_UNITS,
      error: err.message,
    });
  }
});

// ── Update ────────────────────────────────────────────────────────────────────
router.post('/:id', marketplaceUpload.single('image'), async (req, res) => {
  const id = oid(req.params.id);
  try {
    const db = req.db;
    const existing = await db.collection('marketplace_listings').findOne({ _id: id });
    if (!existing) return res.redirect('/admin/marketplace?error=' + encodeURIComponent('Listing not found'));

    const data = readBody(req);
    if (!data.title) throw new Error('Title is required');

    const set = { ...data, updatedAt: new Date() };

    // Keep the slug stable unless the title changed enough to warrant a new one
    // AND the current slug looks auto-derived; simplest: keep existing slug.
    set.slug = existing.slug;

    // Image handling: new upload replaces (and deletes old); explicit remove clears.
    let imageUrl = existing.imageUrl;
    let bucketKey = existing.bucketKey;
    if (req.file?.location) {
      if (existing.bucketKey) await deleteS3Key(existing.bucketKey);
      imageUrl = req.file.location;
      bucketKey = req.file.key;
    } else if (req.body.removeImage === '1') {
      if (existing.bucketKey) await deleteS3Key(existing.bucketKey);
      imageUrl = '';
      bucketKey = '';
    } else if (req.body.imageUrlManual !== undefined && req.body.imageUrlManual.trim() !== existing.imageUrl) {
      imageUrl = req.body.imageUrlManual.trim();
      bucketKey = '';
    }
    set.imageUrl = imageUrl;
    set.bucketKey = bucketKey;

    await db.collection('marketplace_listings').updateOne({ _id: id }, { $set: set });
    res.redirect('/admin/marketplace?success=' + encodeURIComponent('Listing updated'));
  } catch (err) {
    console.error('[marketplace] update error:', err);
    const listing = await req.db.collection('marketplace_listings').findOne({ _id: id });
    res.render('admin/marketplace/form', {
      user: req.adminUser, page: 'marketplace',
      listing, MARKET_KINDS, MARKET_STATUSES, MARKET_STATUS_LABELS, PRICE_UNITS,
      error: err.message,
    });
  }
});

// ── Quick status change (active / draft / sold) ───────────────────────────────
router.post('/:id/status', async (req, res) => {
  try {
    const status = MARKET_STATUSES.includes(req.body.status) ? req.body.status : null;
    if (!status) throw new Error('Bad status');
    await req.db.collection('marketplace_listings').updateOne(
      { _id: oid(req.params.id) }, { $set: { status, updatedAt: new Date() } });
    res.redirect('/admin/marketplace?success=' + encodeURIComponent('Status updated'));
  } catch (err) {
    res.redirect('/admin/marketplace?error=' + encodeURIComponent('Could not update status'));
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    const listing = await db.collection('marketplace_listings').findOne({ _id: oid(req.params.id) });
    if (listing?.bucketKey) await deleteS3Key(listing.bucketKey);
    await db.collection('marketplace_listings').deleteOne({ _id: oid(req.params.id) });
    res.redirect('/admin/marketplace?success=' + encodeURIComponent('Listing deleted'));
  } catch (err) {
    console.error('[marketplace] delete error:', err);
    res.redirect('/admin/marketplace?error=' + encodeURIComponent('Delete failed'));
  }
});

export default router;
