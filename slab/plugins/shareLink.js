/**
 * Share links — one reusable, cross-content, per-tenant short-link system.
 *
 * Every share token lives in the TENANT database (`req.db`), so a token is
 * implicitly scoped to the tenant whose `Host` resolved the request. The same
 * `/s/:token` redirect therefore resolves to different content on different
 * tenants — links are content- AND tenant-specific by construction.
 *
 * A token is minted once per (collection, docId) and reused thereafter, so the
 * same piece of content always shares under a stable URL (good for analytics
 * and for not invalidating links people have already shared).
 */
import { randomBytes } from 'crypto';

// Public path base per shareable source. For the `blog` collection the base is
// chosen by `contentType` (blog/newsletter/help all live in one collection).
// `null` means the source has no public permalink and cannot be shared.
const CONTENT_TYPE_BASE = { blog: '/blog', newsletter: '/newsletter', help: '/help' };

/** Resolve the public, tenant-relative path for a share-link doc. */
export function shareTargetPath(link) {
  if (!link) return null;
  if (link.collection === 'blog') {
    const base = CONTENT_TYPE_BASE[link.contentType] || '/blog';
    return link.slug ? `${base}/${link.slug}` : base;
  }
  if (link.collection === 'pages') {
    return link.slug ? `/${link.slug}` : '/';
  }
  // Unknown source — fall back to whatever slug/path we stored.
  return link.path || (link.slug ? `/${link.slug}` : '/');
}

/** True when a given source can produce a public, shareable permalink. */
export function isShareable({ collection, contentType, slug }) {
  if (!slug) return false;
  if (collection === 'blog') return CONTENT_TYPE_BASE[contentType] != null;
  if (collection === 'pages') return true;
  return false;
}

// Ensure the share_links indexes exist on a tenant db — once per process per
// db. `token` is unique (backs the redirect lookup + collision retry);
// (collection, docId) is unique so re-minting is a stable upsert.
const _indexed = new Set();
async function ensureShareIndexes(db) {
  const name = db.databaseName;
  if (_indexed.has(name)) return;
  _indexed.add(name);
  try {
    const col = db.collection('share_links');
    await col.createIndex({ token: 1 }, { unique: true });
    await col.createIndex({ collection: 1, docId: 1 }, { unique: true });
  } catch (e) {
    _indexed.delete(name); // let a later call retry
    console.warn('[shareLink] index ensure failed (non-fatal):', e.message);
  }
}

function genToken(len = 7) {
  // Unambiguous base-56 alphabet (no 0/O/1/l/I) — short, URL-safe, copy-safe.
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}

/**
 * Get-or-create the share-link doc for a piece of content. Idempotent per
 * (collection, docId): re-minting returns the existing token but refreshes the
 * denormalized title/slug/image/contentType so the link tracks edits.
 *
 * @returns {Promise<object|null>} the share_links doc, or null if not shareable.
 */
export async function mintShareToken(db, { collection, docId, slug, contentType, title, image }) {
  if (!db || !collection || !docId) return null;
  if (!isShareable({ collection, contentType, slug })) return null;

  await ensureShareIndexes(db);
  const docIdStr = String(docId);
  const col = db.collection('share_links');
  const now = new Date();
  const fields = {
    collection, docId: docIdStr, slug: slug || '',
    contentType: contentType || null,
    title: title || '', image: image || '', updatedAt: now,
  };

  const existing = await col.findOne({ collection, docId: docIdStr });
  if (existing) {
    await col.updateOne({ _id: existing._id }, { $set: fields });
    return { ...existing, ...fields };
  }

  // New link — retry a couple times on the (unlikely) token collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = genToken();
    try {
      const doc = { token, ...fields, clicks: 0, createdAt: now };
      await col.insertOne(doc);
      return doc;
    } catch (err) {
      if (err?.code === 11000) {
        // Either a token collision (retry) or a concurrent first-mint of the
        // same content (another request won the race — return its link).
        const raced = await col.findOne({ collection, docId: docIdStr });
        if (raced) return raced;
        continue;
      }
      throw err;
    }
  }
  return null;
}

/** Build the absolute share URL (`https://tenant.dom/s/<token>`) from a request. */
export function shareUrlFor(req, token) {
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${proto}://${req.hostname}/s/${token}`;
}
