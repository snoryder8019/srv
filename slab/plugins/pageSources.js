/**
 * Slab — Page Data Sources ("module pipes")
 * ------------------------------------------
 * The Pages builder is additive: a page is a stack of blocks, and a `datalist`
 * block pipes another module's published content INTO a page — read-only and
 * one-directional ("half-moon"). Each module stays isolated in its own admin;
 * this registry only knows how to READ a page of its content for display.
 *
 * ONE registry, ONE query choke point (`runSource`), used by BOTH:
 *   - public render      (routes/index.js — hydrates each datalist block)
 *   - inline pipe helper (plugins/pipes.js — {{module "blog" limit=3}})
 *
 * Adding a new pipeable module = one entry in PAGE_SOURCES. It then lights up in
 * the builder's source <select>, in public render, and in {{module}} at once.
 *
 * This file imports nothing from index.js / pipes.js — both import FROM it — so
 * there is no circular dependency. It receives the tenant `db` as a parameter and
 * therefore never crosses a tenant boundary.
 */

/**
 * @typedef {Object} PageSource
 * @property {string} collection   Mongo collection to read.
 * @property {Object} query        Base filter (status gate). Cloned per call.
 * @property {Object} sort         Sort spec.
 * @property {?string} hrefBase    URL base for a card link (`${hrefBase}/${slug}`); null = no permalink.
 * @property {?string} groupField  Doc field a `group` filter applies to; null = grouping unsupported.
 * @property {'link'|'modal'} kind How a card behaves on the public page.
 * @property {string} label        Human label for the builder select.
 */

/** @type {Record<string, PageSource>} */
export const PAGE_SOURCES = {
  blog: {
    collection: 'blog',
    // Legacy blog docs predate the contentType field — treat them as 'blog'.
    query: { status: 'published', contentType: { $in: ['blog', null] } },
    sort: { publishedAt: -1, createdAt: -1 },
    hrefBase: '/blog', groupField: null, kind: 'link', label: 'Blog Posts',
  },
  newsletter: {
    collection: 'blog',
    query: { status: 'published', contentType: 'newsletter' },
    sort: { publishedAt: -1, createdAt: -1 },
    hrefBase: '/newsletter', groupField: null, kind: 'link', label: 'Newsletter',
  },
  help: {
    collection: 'blog',
    query: { status: 'published', contentType: 'help' },
    sort: { publishedAt: -1, createdAt: -1 },
    hrefBase: '/help', groupField: null, kind: 'link', label: 'Help Articles',
  },
  portfolio: {
    collection: 'portfolio',
    // Portfolio items have no draft workflow — anything not explicitly drafted is visible.
    query: { status: { $ne: 'draft' } },
    sort: { order: 1, createdAt: -1 },
    hrefBase: null, groupField: 'group', kind: 'modal', label: 'Portfolio',
  },
  careers: {
    collection: 'jobs',
    query: { status: 'open' },
    sort: { publishedAt: -1, createdAt: -1 },
    hrefBase: '/careers', groupField: 'department', kind: 'link', label: 'Careers / Jobs',
  },
  marketplace: {
    collection: 'marketplace_listings',
    query: { status: 'active' },
    sort: { featured: -1, order: 1, createdAt: -1 },
    hrefBase: '/marketplace', groupField: 'category', kind: 'link', label: 'Marketplace',
  },
};

export const PAGE_SOURCE_KEYS = Object.keys(PAGE_SOURCES);

/** Resolve a source key to its definition, falling back to blog for anything unknown. */
export function resolveSource(sourceKey) {
  return PAGE_SOURCES[sourceKey] ? sourceKey : 'blog';
}

/**
 * Normalize any source document into a uniform card the view can render without
 * knowing which module it came from. `raw` is kept so the portfolio modal can
 * still reach gallery / showDate etc.
 */
export function toCard(sourceKey, item) {
  const src = PAGE_SOURCES[resolveSource(sourceKey)];
  const slug = item.slug || '';
  return {
    id: item._id,
    title: item.title || '',
    image: item.featuredImageUrl || item.imageUrl || item.coverImage || item.heroImage || '',
    excerpt: item.excerpt || item.summary || item.description || item.metaDescription || '',
    date: item.publishedAt || item.projectDate || item.createdAt || null,
    href: src.hrefBase && slug ? `${src.hrefBase}/${slug}` : null,
    kind: src.kind,
    raw: item,
  };
}

/**
 * Read one page of a source's content. The SINGLE place a source query runs, so
 * every caller inherits the same allowlist, clamping and group handling.
 * @param {import('mongodb').Db} db  tenant db (req.db)
 * @param {string} sourceKey
 * @param {{page?:number, perPage?:number, group?:string}} [opts]
 * @returns {Promise<{items:Array, total:number, source:string}>}
 */
export async function runSource(db, sourceKey, { page = 1, perPage = 9, group = '' } = {}) {
  const key = resolveSource(sourceKey);
  const src = PAGE_SOURCES[key];
  const per = Math.min(Math.max(parseInt(perPage) || 9, 1), 100);
  const p = Math.max(1, parseInt(page) || 1);

  const query = { ...src.query };
  if (group && src.groupField) query[src.groupField] = group;

  const [total, docs] = await Promise.all([
    db.collection(src.collection).countDocuments(query),
    db.collection(src.collection).find(query).sort(src.sort).skip((p - 1) * per).limit(per).toArray(),
  ]);
  return { items: docs.map(d => toCard(key, d)), total, source: key };
}

/**
 * Legacy → unified migration, done IN MEMORY on read (never persisted). Pure and
 * idempotent: a page that already has blocks is returned untouched. A legacy
 * content page becomes one html block; a legacy data-list page becomes one
 * datalist block. Called by both the edit form and public render so there is a
 * single block-stack code path everywhere.
 */
export function synthesizeLegacyBlocks(pg) {
  if (!pg) return [];
  if (Array.isArray(pg.blocks) && pg.blocks.length) return pg.blocks;

  if (pg.pageType === 'data-list') {
    const source = pg.dataCollection === 'portfolio' ? 'portfolio' : 'blog';
    return [{
      type: 'datalist',
      fields: {
        heading: '',
        source,
        pageSize: String(pg.dataPageSize || 9),
        group: source === 'portfolio' ? (pg.dataGroup || '') : '',
        paginate: 'true',
      },
      images: {},
    }];
  }

  // content pages (and any legacy doc that only carries `content`)
  if (pg.content) {
    return [{ type: 'html', fields: { html: pg.content }, images: {} }];
  }

  return [];
}

export default { PAGE_SOURCES, PAGE_SOURCE_KEYS, resolveSource, toCard, runSource, synthesizeLegacyBlocks };
