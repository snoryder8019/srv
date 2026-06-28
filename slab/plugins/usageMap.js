// ── Usage / connection map ───────────────────────────────────────────────────
// Tenant-scoped helpers that answer "is this asset/draft/campaign actually in
// use, or is it a cleanup candidate?". Used by the asset center (per-asset
// badge), the email campaigns list, and the dashboard agent's /usage endpoint.
//
// All functions take the TENANT db (req.db) and never touch the slab registry.

const DAY = 24 * 60 * 60 * 1000;

/**
 * Walk every collection that can reference a stored asset and collect the URLs,
 * bucket keys, and asset ids they point at. Returned sets let us decide, for any
 * asset, whether something still links to it.
 *
 * References store the full `publicUrl` in most places, the `bucketKey` in a few
 * (portfolio, sections, section_media), and an `_id` in one (social_posts.assetIds).
 */
export async function buildAssetReferenceIndex(db) {
  const urls = new Set();
  const keys = new Set();
  const ids = new Set();
  const refBy = new Map();   // url|key|id  →  Set(collection labels) — for "used by" tooltips

  const tag = (val, label) => {
    if (!val) return;
    const k = String(val).trim();
    if (!k) return;
    if (!refBy.has(k)) refBy.set(k, new Set());
    refBy.get(k).add(label);
  };
  const addUrl = (u, label) => { if (u && typeof u === 'string') { urls.add(u.trim()); tag(u, label); } };
  const addKey = (k, label) => { if (k && typeof k === 'string') { keys.add(k.trim()); tag(k, label); } };
  const addId  = (i, label) => { if (i) { ids.add(String(i)); tag(String(i), label); } };

  const safe = (fn) => fn().catch(() => {});
  const find = (name, proj) => db.collection(name).find({}).project(proj).toArray();

  await Promise.all([
    safe(async () => (await find('blog', { featuredImageUrl: 1 }))
      .forEach(d => addUrl(d.featuredImageUrl, 'Blog'))),

    safe(async () => (await find('pages', { blocks: 1, ogImage: 1 })).forEach(d => {
      addUrl(d.ogImage, 'Pages');
      (d.blocks || []).forEach(b => (b.images || []).forEach(img => addUrl(img?.url, 'Pages')));
    })),

    safe(async () => (await find('portfolio', { imageUrl: 1, bucketKey: 1, gallery: 1 })).forEach(d => {
      addUrl(d.imageUrl, 'Portfolio');
      addKey(d.bucketKey, 'Portfolio');
      (d.gallery || []).forEach(g => addUrl(g?.url, 'Portfolio'));
    })),

    safe(async () => (await find('custom_sections', { images: 1 })).forEach(d => {
      Object.values(d.images || {}).forEach(img => { addUrl(img?.url, 'Sections'); addKey(img?.bucketKey, 'Sections'); });
    })),

    safe(async () => (await find('section_media', { url: 1, bucketKey: 1 })).forEach(d => {
      addUrl(d.url, 'Homepage'); addKey(d.bucketKey, 'Homepage');
    })),

    safe(async () => (await find('brand_images', { url: 1 }))
      .forEach(d => addUrl(d.url, 'Brand'))),

    safe(async () => (await find('brand_models', { url: 1 }))
      .forEach(d => addUrl(d.url, 'Brand 3D'))),

    safe(async () => (await find('social_posts', { mediaUrls: 1, assetIds: 1 })).forEach(d => {
      (d.mediaUrls || []).forEach(u => addUrl(u, 'Social'));
      (d.assetIds || []).forEach(i => addId(i, 'Social'));
    })),

    safe(async () => (await find('print_materials', { bgImageUrl: 1, layouts: 1 })).forEach(d => {
      addUrl(d.bgImageUrl, 'Print');
      Object.values(d.layouts || {}).forEach(fmt => (fmt?.objects || []).forEach(o => addUrl(o?.url, 'Print')));
    })),
  ]);

  return { urls, keys, ids, refBy };
}

/** True if anything still links to this asset. */
export function assetIsReferenced(asset, idx) {
  if (!asset || !idx) return false;
  const u = asset.publicUrl?.trim();
  const k = asset.bucketKey?.trim();
  return Boolean(
    (u && idx.urls.has(u)) ||
    (k && idx.keys.has(k)) ||
    idx.ids.has(String(asset._id)),
  );
}

/** The list of areas (collection labels) that reference this asset. */
export function assetReferrers(asset, idx) {
  if (!asset || !idx) return [];
  const out = new Set();
  for (const key of [asset.publicUrl?.trim(), asset.bucketKey?.trim(), String(asset._id)]) {
    if (key && idx.refBy.has(key)) idx.refBy.get(key).forEach(l => out.add(l));
  }
  return [...out];
}

/**
 * Annotate a list of asset docs in-place-ish (returns new objects) with:
 *   inUse    — boolean
 *   usedBy   — string[] of areas linking to it
 *   isRecent — uploaded within `graceDays` (don't nag about brand-new uploads)
 *   cleanup  — boolean: safe-to-review candidate (unused AND past the grace window)
 */
export function annotateAssets(assets, idx, { graceDays = 7 } = {}) {
  const cutoff = Date.now() - graceDays * DAY;
  return assets.map(a => {
    const inUse = assetIsReferenced(a, idx);
    const ts = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
    const isRecent = ts > cutoff;
    return { ...a, inUse, usedBy: inUse ? assetReferrers(a, idx) : [], isRecent, cleanup: !inUse && !isRecent };
  });
}

/**
 * Cross-module activity map: stale drafts and dead campaigns the owner can clean
 * up. Cheap count-only queries so it's safe to call on dashboard load.
 */
export async function buildActivityMap(db, { staleDays = 30 } = {}) {
  const staleBefore = new Date(Date.now() - staleDays * DAY);
  const c = (n) => db.collection(n);
  const cd = (n, q) => c(n).countDocuments(q).catch(() => 0);

  const staleQ = (field = 'updatedAt') => ({ status: 'draft', [field]: { $lt: staleBefore } });

  const [
    blogDraftsStale, pagesDraftsStale, socialDraftsStale,
    campaignsDraftStale, invoicesDraftStale,
    blogDrafts, pagesDrafts, socialDrafts, campaignsDraft,
    campaignsSentNoReach,
  ] = await Promise.all([
    cd('blog', staleQ()),
    cd('pages', staleQ()),
    cd('social_posts', { status: 'draft', createdAt: { $lt: staleBefore } }),
    cd('campaigns', { status: 'draft', createdAt: { $lt: staleBefore } }),
    cd('invoices', { status: 'draft', createdAt: { $lt: staleBefore } }),
    cd('blog', { status: 'draft' }),
    cd('pages', { status: 'draft' }),
    cd('social_posts', { status: 'draft' }),
    cd('campaigns', { status: 'draft' }),
    cd('campaigns', { status: 'sent', $or: [{ sentCount: { $lte: 0 } }, { sentCount: { $exists: false } }] }),
  ]);

  const staleDrafts = blogDraftsStale + pagesDraftsStale + socialDraftsStale + campaignsDraftStale + invoicesDraftStale;
  const totalDrafts = blogDrafts + pagesDrafts + socialDrafts + campaignsDraft;

  return {
    staleDays,
    drafts: {
      total: totalDrafts,
      stale: staleDrafts,
      byModule: {
        blog: blogDraftsStale, pages: pagesDraftsStale, social: socialDraftsStale,
        campaigns: campaignsDraftStale, invoices: invoicesDraftStale,
      },
    },
    campaigns: {
      neverSent: campaignsDraft,
      sentNoReach: campaignsSentNoReach,
    },
  };
}
