/**
 * sLab Network — cross-tenant aggregation for the public /network hub.
 *
 * The Network is the platform's own back-channel page: a directory of the brands
 * built on sLab plus the content those brands opt to syndicate (job boards, press
 * releases, videos, marketplace listings), alongside platform-level funnels
 * (sales delegates, the inference-mesh waitlist) and the template store.
 *
 * Opt-in lives on the registry `tenants` doc as string flags on `public.*` (the
 * same 'true'/'false' convention as chatbotEnabled), set at /admin/settings:
 *   public.networkOptIn   — master: join the network (directory + footer backlink)
 *   public.networkJobs     — syndicate open job postings
 *   public.networkPress    — syndicate published press releases
 *   public.networkVideo    — syndicate latest YouTube uploads
 *   public.networkMarket   — syndicate active marketplace listings
 *
 * Everything here reads the registry DB (getSlabDb) and fans out to each opted-in
 * tenant's own DB (getTenantDb) — the same pattern the superadmin dashboard uses.
 * Per-tenant reads are wrapped so one dead tenant DB never takes the page down.
 */
import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from './mongo.js';
import { fetchChannelUploads } from './youtube.js';
import { publicListing } from './marketplaceHelpers.js';
import { captureLead } from './subscribe.js';
import { buildNetworkMap } from './networkMap.js';

const TRUE = 'true';
const JOBS_CAP = 60;      // hard ceilings so the hub stays fast as the network grows
const PRESS_CAP = 30;
const VIDEO_CAP = 24;
const MARKET_CAP = 60;
const VIDEOS_PER_BRAND = 3;
const LISTINGS_PER_BRAND = 8;
const FOLLOW_MAX = 60;        // cap members subscribed in one hub "follow" action

// Writer-content syndication is content-type-driven: each public content type a
// tenant writes (blog / newsletter / help / …) routes to its OWN network section,
// exactly as it lands on the tenant's own site. This mirrors PUBLIC_CONTENT in
// routes/index.js (base paths must match) — add a public content type there and a
// row here and it flows onto the hub automatically, no other wiring. `match` is
// the Mongo contentType filter (legacy blog docs predate the field → treated as
// 'blog'); `image` = show a hero thumb; `noun` seeds the empty-state copy.
const CONTENT_SECTIONS = [
  { key: 'blog',       match: { $in: ['blog', null] }, base: '/blog',       label: 'From the blogs', subtitle: 'reading across the network',                              noun: 'blog posts',        image: true,  perBrand: 4, cap: 36 },
  { key: 'newsletter', match: 'newsletter',            base: '/newsletter', label: 'Newsletters',    subtitle: 'issues from the network — follow the brands to get them', noun: 'newsletter issues', image: false, perBrand: 3, cap: 24 },
  { key: 'help',       match: 'help',                  base: '/help',       label: 'Help & guides',  subtitle: 'how-tos and docs from across the network',               noun: 'help articles',     image: false, perBrand: 4, cap: 30 },
];
// Clean metadata handed to the view (drops the Mongo `match` filter).
const CONTENT_SECTION_META = CONTENT_SECTIONS.map(({ key, base, label, subtitle, noun, image }) => ({ key, base, label, subtitle, noun, image }));

/** Public https:// base for a registry tenant doc (custom domain wins). */
export function tenantPublicUrl(t) {
  const host = t?.meta?.customDomain || t?.public?.customDomain || t?.domain || '';
  return host ? 'https://' + host : '';
}

/** Registry docs for every tenant that has joined the network. */
export async function getNetworkTenants() {
  const slab = getSlabDb();
  return slab.collection('tenants').find({
    'public.networkOptIn': TRUE,
    status: { $in: ['active', 'preview'] },
  }).sort({ 'meta.lastSeenAt': -1, createdAt: -1 }).toArray();
}

/**
 * Build the full data bundle the /network view renders. Never throws — each
 * section degrades to an empty list / zero count on error.
 */
export async function buildNetworkData() {
  const slab = getSlabDb();
  const members = await getNetworkTenants().catch(() => []);

  // Fan out once per member: logo + syndicated content, tolerating a down tenant DB.
  const enriched = await Promise.all(members.map(async (t) => {
    const brand = t.brand || {};
    let logo = null;
    let openJobs = 0;
    let jobs = [];
    let press = [];
    let videos = [];
    let market = [];
    let content = {};
    try {
      const tdb = getTenantDb(t.db, t.dbHost);
      const wantsJobs    = t.public?.networkJobs === TRUE;
      const wantsPress   = t.public?.networkPress === TRUE;
      const wantsVideo   = t.public?.networkVideo === TRUE;
      const wantsMarket  = t.public?.networkMarket === TRUE;
      const wantsContent = t.public?.networkContent === TRUE;  // writer content (blog/newsletter/help/…)
      const [logoDoc, jobDocs, pressDocs, ytChannelDoc, marketDocs, contentDocs] = await Promise.all([
        tdb.collection('brand_images').findOne({ slot: 'logo_primary' }).catch(() => null),
        wantsJobs
          ? tdb.collection('jobs').find({ status: 'open' })
              .sort({ publishedAt: -1 }).limit(12).toArray().catch(() => [])
          : [],
        wantsPress
          ? tdb.collection('blog').find({ status: 'published', contentType: 'press' })
              .sort({ publishedAt: -1, createdAt: -1 }).limit(8).toArray().catch(() => [])
          : [],
        wantsVideo
          ? tdb.collection('design').findOne({ key: 'youtube_channel' }).catch(() => null)
          : null,
        wantsMarket
          ? tdb.collection('marketplace_listings')
              .find({ status: 'active', networkShare: { $ne: false } })
              .sort({ featured: -1, createdAt: -1 }).limit(LISTINGS_PER_BRAND).toArray().catch(() => [])
          : [],
        // Writer content — one query per content type, routed to its own section.
        wantsContent
          ? Promise.all(CONTENT_SECTIONS.map(sec =>
              tdb.collection('blog').find({ status: 'published', contentType: sec.match })
                .sort({ publishedAt: -1, createdAt: -1 }).limit(sec.perBrand).toArray().catch(() => [])
            ))
          : [],
      ]);
      logo = logoDoc?.url || null;
      const base = tenantPublicUrl(t);
      jobs = (jobDocs || []).map(j => ({
        title: j.title || 'Open role',
        department: j.department || '',
        location: j.location || [j.city, j.region].filter(Boolean).join(', ') || (j.remote ? 'Remote' : ''),
        employmentType: j.employmentType || '',
        remote: !!j.remote,
        url: `${base}/careers/${j.slug}`,
        brandName: brand.name || t.domain,
      }));
      openJobs = jobs.length;
      press = (pressDocs || []).map(p => ({
        title: p.title || 'Announcement',
        excerpt: p.excerpt || p.summary || '',
        date: p.publishedAt || p.createdAt || null,
        url: `${base}/blog/${p.slug}`,
        brandName: brand.name || t.domain,
      }));

      // Marketplace syndication — active, network-shared listings, shaped the same
      // way the tenant's own /marketplace page renders them (via publicListing).
      market = (marketDocs || []).map(l => publicListing(l, base, brand.name || t.domain));

      // Writer-content syndication — each public content type routed to its own
      // section, linked to the member's own archive (/blog/:slug, /newsletter/:slug,
      // /help/:slug, …). Same shape for every type; the view decides the layout.
      CONTENT_SECTIONS.forEach((sec, i) => {
        content[sec.key] = (contentDocs[i] || []).map(p => ({
          title: p.title || sec.label,
          excerpt: p.excerpt || p.summary || '',
          date: p.publishedAt || p.createdAt || null,
          image: sec.image ? (p.featuredImageUrl || null) : null,
          url: `${base}${sec.base}/${p.slug}`,
          brandName: brand.name || t.domain,
        }));
      });

      // Video syndication — latest uploads from the tenant's configured YouTube
      // channel, fetched keylessly via the shared RSS helper (feed-cached in that
      // plugin, so repeated hub loads don't re-hit YouTube). Best-effort.
      const ytChannel = String(ytChannelDoc?.value || '').trim();
      if (wantsVideo && ytChannel) {
        const feed = await fetchChannelUploads({ channel: ytChannel, limit: VIDEOS_PER_BRAND })
          .catch(() => ({ ok: false, videos: [] }));
        videos = (feed?.videos || []).slice(0, VIDEOS_PER_BRAND).map(v => ({
          title: v.title || 'Video',
          url: v.url,
          thumb: v.thumb,
          date: v.publishedAt || null,
          brandName: brand.name || t.domain,
        }));
      }
    } catch { /* tenant DB unavailable — brand still lists, just without enrich */ }

    return {
      directory: {
        name: brand.name || t.domain,
        tagline: brand.tagline || '',
        industry: brand.industry || '',
        url: tenantPublicUrl(t),
        logo,
        openJobs,
        // Follow ("one email, follow many"): stable opaque id + whether this member
        // accepts hub-driven newsletter subscribers.
        key: String(t._id),
        followable: t.public?.networkFollow === TRUE,
      },
      jobs,
      press,
      videos,
      market,
      content,
    };
  }));

  const byDate = (a, b) => new Date(b.date || 0) - new Date(a.date || 0);
  const directory = enriched.map(e => e.directory);
  const jobs   = enriched.flatMap(e => e.jobs).slice(0, JOBS_CAP);
  const press  = enriched.flatMap(e => e.press).slice(0, PRESS_CAP);
  const videos = enriched.flatMap(e => e.videos).slice(0, VIDEO_CAP);
  // Writer content — aggregate each content type across members, newest first.
  const content = {};
  for (const sec of CONTENT_SECTIONS) {
    content[sec.key] = enriched.flatMap(e => e.content[sec.key] || []).sort(byDate).slice(0, sec.cap);
  }
  // Marketplace: featured listings float to the top of the hub grid.
  const market = enriched.flatMap(e => e.market)
    .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))
    .slice(0, MARKET_CAP);

  // Registry-DB sections (already cross-tenant by nature) — each best-effort.
  const [map, templates, delegateCount, waitlistCount] = await Promise.all([
    // Presence map: brands + delegates + waitlist geocoded offline (plugins/geoUS.js).
    buildNetworkMap(members).catch((err) => {
      console.error('[network] map build failed:', err.message);
      return null;
    }),
    slab.collection('template_store')
      .find({ status: 'active' }).sort({ score: -1, downloads: -1 }).limit(12).toArray()
      .then(rows => rows.map(r => ({
        name: r.name || 'Untitled template',
        category: r.category || 'general',
        downloads: r.downloads || 0,
        id: String(r._id),
      })))
      .catch(() => []),
    slab.collection('sales_delegates').countDocuments({}).catch(() => 0),
    slab.collection('network_waitlist').countDocuments({}).catch(() => 0),
  ]);

  return {
    map,
    stats: {
      brands: directory.length,
      jobs: jobs.length,
      press: press.length,
      videos: videos.length,
      market: market.length,
      blogs: content.blog?.length || 0,
      news: content.newsletter?.length || 0,
      help: content.help?.length || 0,
      templates: templates.length,
      delegates: delegateCount,
      waitlist: waitlistCount,
    },
    directory,
    jobs,
    press,
    videos,
    market,
    content,
    contentSections: CONTENT_SECTION_META,
    templates,
    delegates: { count: delegateCount, signupUrl: '/delegates/signup' },
    waitlist: { count: waitlistCount },
  };
}

/**
 * "Follow many" — subscribe one email to several network members at once from the
 * public hub. Only members that both joined the network AND enabled follow are
 * honored. Each subscribe runs through the shared captureLead pipeline (single
 * opt-in, tagged `network-follow`) against that tenant's own DB — the same fan-out
 * pattern the hub uses to read. Best-effort per member; never throws.
 *
 * @returns {Promise<{ ok, status:'ok'|'invalid', subscribed:number, failed:number, total:number }>}
 */
export async function followMembers({ email, keys } = {}) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, status: 'invalid', subscribed: 0, failed: 0, total: 0 };

  const wanted = (Array.isArray(keys) ? keys : String(keys || '').split(','))
    .map(s => String(s).trim()).filter(Boolean).slice(0, FOLLOW_MAX);
  const ids = [];
  for (const k of wanted) { try { ids.push(new ObjectId(k)); } catch { /* skip bad id */ } }

  const slab = getSlabDb();
  const query = {
    'public.networkOptIn': TRUE,
    'public.networkFollow': TRUE,
    status: { $in: ['active', 'preview'] },
    ...(ids.length ? { _id: { $in: ids } } : {}),   // empty selection ⇒ follow all followable members
  };
  const members = await slab.collection('tenants').find(query).limit(FOLLOW_MAX).toArray().catch(() => []);

  let subscribed = 0, failed = 0;
  for (const t of members) {
    try {
      const tdb = getTenantDb(t.db, t.dbHost);
      const r = await captureLead({
        db: tdb, tenant: t, email: clean,
        funnel: 'network', source: 'network', tags: ['network-follow'], optIn: 'single',
      });
      if (['subscribed', 'exists', 'ignored'].includes(r.status)) subscribed++;
      else failed++;
    } catch { failed++; }
  }
  return { ok: subscribed > 0, status: 'ok', subscribed, failed, total: members.length };
}

/**
 * Record an inference-mesh waitlist signup. De-dupes on email. Returns
 * { ok, status } where status is 'added' | 'exists' | 'invalid'.
 */
export async function joinWaitlist({ email, name, note, location, ip } = {}) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, status: 'invalid' };
  const slab = getSlabDb();
  const col = slab.collection('network_waitlist');
  const existing = await col.findOne({ email: clean }).catch(() => null);
  if (existing) return { ok: true, status: 'exists' };
  await col.insertOne({
    email: clean,
    name: String(name || '').trim().slice(0, 120),
    note: String(note || '').trim().slice(0, 500),
    // Optional, self-reported, free text ("Austin, TX"). Resolved offline at
    // render time by plugins/geoUS.js — we never geocode or store a lat/lng,
    // and never infer position from `ip`.
    location: String(location || '').trim().slice(0, 120),
    list: 'inference-mesh',
    ip: String(ip || '').slice(0, 64),
    createdAt: new Date(),
  });
  return { ok: true, status: 'added' };
}
