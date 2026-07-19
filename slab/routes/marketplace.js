/**
 * Public — Marketplace  (mounted at /marketplace on the tenant's own site)
 *
 * GET /marketplace         → grid of the tenant's ACTIVE listings
 * GET /marketplace/:slug   → a single active listing
 *
 * Visibility + layout are controlled from the admin Designer (design keys
 * vis_marketplace / marketplace_heading / marketplace_sub / marketplace_columns
 * / marketplace_show_price). When vis_marketplace is off the storefront is
 * hidden (falls through to 404). Only 'active' listings are ever exposed.
 */
import express from 'express';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { formatPrice } from '../plugins/marketplaceHelpers.js';

const router = express.Router();

async function getDesign(db) {
  const design = { ...DESIGN_DEFAULTS };
  if (!db) return design;
  const rows = await db.collection('design').find({}).toArray();
  for (const item of rows) design[item.key] = item.value;
  return design;
}

const siteOrigin = (req) => {
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${proto}://${req.tenant?.domain || req.hostname}`;
};

// Storefront visibility is a Designer toggle (opt-in).
const marketplaceOn = (design) => design.vis_marketplace === 'true';

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    if (!req.db) return next();
    const design = await getDesign(req.db);
    if (!marketplaceOn(design)) return next();

    const listings = await req.db.collection('marketplace_listings')
      .find({ status: 'active' })
      .sort({ featured: -1, order: 1, createdAt: -1 }).toArray();

    const brand = res.locals.brand || {};
    const showPrice = design.marketplace_show_price !== 'false';
    const items = listings.map((l) => ({
      title: l.title, slug: l.slug, kind: l.kind || 'product',
      category: l.category || '', summary: l.summary || '',
      price: showPrice ? formatPrice(l) : '', image: l.imageUrl || '', featured: !!l.featured,
    }));

    const origin = siteOrigin(req);
    const heading = design.marketplace_heading || 'Marketplace';
    res.setSeo?.({
      title: `${heading} — ${brand.name || 'Shop'}`,
      description: design.marketplace_sub || `Browse products and services from ${brand.name || 'us'}.`,
      canonical: `${origin}/marketplace`,
    });
    res.render('marketplace/index', {
      design, brand, items,
      heading,
      sub: design.marketplace_sub || '',
      columns: ['2', '3', '4'].includes(String(design.marketplace_columns)) ? String(design.marketplace_columns) : '3',
      showPrice,
    });
  } catch (err) {
    console.error('[marketplace/public] list error:', err);
    next(err);
  }
});

// ── Detail ────────────────────────────────────────────────────────────────────
router.get('/:slug', async (req, res, next) => {
  try {
    if (!req.db) return next();
    const design = await getDesign(req.db);
    if (!marketplaceOn(design)) return next();

    const listing = await req.db.collection('marketplace_listings').findOne({ slug: req.params.slug });
    if (!listing || listing.status !== 'active') return next();

    const brand = res.locals.brand || {};
    const origin = siteOrigin(req);
    const showPrice = design.marketplace_show_price !== 'false';
    res.setSeo?.({
      title: `${listing.title} — ${brand.name || 'Marketplace'}`,
      description: (listing.summary || listing.description || '').replace(/<[^>]+>/g, '').slice(0, 180),
      canonical: `${origin}/marketplace/${listing.slug}`,
      ogType: 'product',
    });
    res.render('marketplace/detail', {
      design, brand, showPrice,
      listing: { ...listing, priceLabel: formatPrice(listing) },
    });
  } catch (err) {
    console.error('[marketplace/public] detail error:', err);
    next(err);
  }
});

export default router;
