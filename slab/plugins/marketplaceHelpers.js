/**
 * Marketplace helpers — shared shaping for the tenant marketplace + the sLab
 * Network syndication of it.
 *
 * A tenant's listings live in their own DB (marketplace_listings). The public
 * tenant page and the cross-tenant /network hub both render the same listing
 * shape, so the projection + price formatting live here to stay in sync.
 */

export const MARKET_KINDS = ['product', 'service'];
export const MARKET_STATUSES = ['active', 'draft', 'sold', 'archived'];
export const MARKET_STATUS_LABELS = {
  active: 'Active', draft: 'Draft', sold: 'Sold', archived: 'Archived',
};

// Optional price qualifier — free-form is allowed, these seed the picker.
export const PRICE_UNITS = ['', 'each', 'hour', 'day', 'month', 'year', 'project', 'sq ft'];

/** URL-safe slug from a title. */
export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/['"]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'listing';
}

/**
 * A slug unique within the tenant's marketplace_listings. Appends -2, -3, … on
 * collision. `excludeId` lets an edit keep its own slug.
 */
export async function uniqueSlug(db, base, excludeId = null) {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await db.collection('marketplace_listings').findOne({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (!clash) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

/** Format a listing price for display, e.g. "$1,200", "$85 / hour", "Contact for pricing". */
export function formatPrice(listing) {
  const p = listing?.price;
  if (p == null || p === '' || Number.isNaN(Number(p))) return 'Contact for pricing';
  const money = '$' + Number(p).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(Number(p)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const unit = (listing.priceUnit || '').trim();
  return unit ? `${money} / ${unit}` : money;
}

/**
 * Public-facing projection of a listing. `base` is the tenant's public origin
 * (https://brand.com) so the detail URL resolves from anywhere (incl. /network).
 */
export function publicListing(listing, base = '', brandName = '') {
  return {
    title: listing.title || 'Untitled',
    slug: listing.slug,
    kind: listing.kind || 'product',
    category: listing.category || '',
    summary: listing.summary || '',
    price: formatPrice(listing),
    priceRaw: listing.price == null || listing.price === '' ? null : Number(listing.price),
    image: listing.imageUrl || '',
    featured: !!listing.featured,
    url: base ? `${base}/marketplace/${listing.slug}` : `/marketplace/${listing.slug}`,
    brandName: brandName || '',
  };
}
