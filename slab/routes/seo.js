/**
 * Dynamic SEO file routes per tenant: robots.txt, sitemap.xml, llms.txt
 *
 * All three derive content from `req.tenant` / `req.db`, so each tenant gets
 * a unique, accurate response based on their published pages and posts.
 */
import express from 'express';

const router = express.Router();

const KNOWN_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'PerplexityBot', 'PerplexityUser',
  'Google-Extended', 'Googlebot', 'Googlebot-Image', 'Googlebot-Video',
  'Bingbot', 'Applebot', 'Applebot-Extended',
  'CCBot', 'Amazonbot', 'meta-externalagent', 'FacebookBot',
  'DuckDuckBot', 'YandexBot',
];

function baseUrl(req) {
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${proto}://${req.hostname}`;
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

router.get('/robots.txt', (req, res) => {
  const tenant = req.tenant;
  const isPreview = tenant?.isPreview || tenant?.status === 'preview';
  res.type('text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');

  if (isPreview) {
    return res.send(['User-agent: *', 'Disallow: /', ''].join('\n'));
  }

  const lines = [];
  for (const bot of KNOWN_BOTS) {
    lines.push(`User-agent: ${bot}`, 'Allow: /', '');
  }
  lines.push(
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /superadmin',
    'Disallow: /delegates',
    'Disallow: /auth',
    'Disallow: /api',
    'Disallow: /webhooks',
    'Disallow: /pay',
    'Disallow: /start',
    'Disallow: /book/confirm',
    '',
    `Sitemap: ${baseUrl(req)}/sitemap.xml`,
    `# AI summary: ${baseUrl(req)}/llms.txt`,
    '',
  );
  res.send(lines.join('\n'));
});

router.get('/sitemap.xml', async (req, res) => {
  const root = baseUrl(req);
  res.type('application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=1800');

  const urls = [
    { loc: `${root}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `${root}/blog`, priority: '0.7', changefreq: 'daily' },
    { loc: `${root}/terms`, priority: '0.2', changefreq: 'yearly' },
    { loc: `${root}/privacy`, priority: '0.2', changefreq: 'yearly' },
  ];

  if (req.db) {
    try {
      const [pages, posts] = await Promise.all([
        req.db.collection('pages').find({ status: 'published' })
          .project({ slug: 1, updatedAt: 1, publishedAt: 1 }).toArray(),
        req.db.collection('blog').find({ status: 'published' })
          .project({ slug: 1, updatedAt: 1, publishedAt: 1 }).toArray(),
      ]);
      for (const p of pages) {
        urls.push({
          loc: `${root}/${p.slug}`,
          lastmod: p.updatedAt || p.publishedAt,
          priority: '0.8', changefreq: 'monthly',
        });
      }
      for (const p of posts) {
        urls.push({
          loc: `${root}/blog/${p.slug}`,
          lastmod: p.updatedAt || p.publishedAt,
          priority: '0.6', changefreq: 'monthly',
        });
      }
    } catch (err) {
      console.warn('[seo] sitemap collection read failed:', err.message);
    }
  }

  const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const u of urls) {
    xml.push('  <url>', `    <loc>${xmlEscape(u.loc)}</loc>`);
    if (u.lastmod) {
      const d = new Date(u.lastmod);
      if (!isNaN(d.getTime())) xml.push(`    <lastmod>${d.toISOString().slice(0, 10)}</lastmod>`);
    }
    if (u.changefreq) xml.push(`    <changefreq>${u.changefreq}</changefreq>`);
    if (u.priority) xml.push(`    <priority>${u.priority}</priority>`);
    xml.push('  </url>');
  }
  xml.push('</urlset>', '');
  res.send(xml.join('\n'));
});

/**
 * /.well-known/agents.json — AAO (AI Agent Optimization) manifest.
 * Tells autonomous agents what this site is and how to interact with it.
 * Format inspired by ai-plugin.json + agents.json drafts; intentionally simple.
 */
router.get(['/.well-known/agents.json', '/agents.json'], async (req, res) => {
  const root = baseUrl(req);
  const tenant = req.tenant;
  const brand = tenant?.brand || {};
  res.type('application/json; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Access-Control-Allow-Origin', '*');

  const manifest = {
    schema_version: '0.1',
    name_for_human: brand.name || 'Slab site',
    name_for_model: (brand.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
    description_for_human: brand.tagline || brand.description || '',
    description_for_model: [
      brand.description || brand.tagline || '',
      brand.industry ? `Industry: ${brand.industry}.` : '',
      brand.businessType ? `Type: ${brand.businessType}.` : '',
      brand.location ? `Located in ${brand.location}.` : '',
      brand.serviceArea ? `Serves ${brand.serviceArea}.` : '',
      Array.isArray(brand.services) && brand.services.length
        ? `Services: ${brand.services.join(', ')}.` : '',
    ].filter(Boolean).join(' '),
    contact: {
      email: brand.email || null,
      phone: brand.phone || null,
    },
    urls: {
      site:    `${root}/`,
      sitemap: `${root}/sitemap.xml`,
      llms:    `${root}/llms.txt`,
      blog:    `${root}/blog`,
      terms:   `${root}/terms`,
      privacy: `${root}/privacy`,
    },
    actions: [
      {
        name: 'get_started',
        description: 'Begin signup / onboarding flow.',
        method: 'GET',
        url: `${root}/start`,
      },
      {
        name: 'book_meeting',
        description: 'Book a meeting or appointment.',
        method: 'GET',
        url: `${root}/book`,
      },
      {
        name: 'contact',
        description: 'Reach the business by email or phone.',
        method: 'mailto',
        url: brand.email ? `mailto:${brand.email}` : null,
      },
      {
        name: 'browse_blog',
        description: 'Read latest posts, news, and updates.',
        method: 'GET',
        url: `${root}/blog`,
      },
    ].filter(a => a.url),
    auth: { type: 'none' },
    legal_info_url: `${root}/terms`,
    privacy_policy_url: `${root}/privacy`,
  };

  res.json(manifest);
});

router.get('/llms.txt', async (req, res) => {
  const root = baseUrl(req);
  const tenant = req.tenant;
  const brand = tenant?.brand || {};
  res.type('text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');

  const lines = [];
  lines.push(`# ${brand.name || 'Slab'}`);
  lines.push('');
  if (brand.tagline) lines.push(`> ${brand.tagline}`);
  else if (brand.description) lines.push(`> ${brand.description.slice(0, 200)}`);
  lines.push('');
  if (brand.description) { lines.push(brand.description); lines.push(''); }

  const facts = [];
  if (brand.industry)     facts.push(`- **Industry:** ${brand.industry}`);
  if (brand.businessType) facts.push(`- **Type:** ${brand.businessType}`);
  if (brand.location)     facts.push(`- **Location:** ${brand.location}`);
  if (brand.serviceArea)  facts.push(`- **Service area:** ${brand.serviceArea}`);
  if (brand.email)        facts.push(`- **Contact:** ${brand.email}`);
  if (brand.phone)        facts.push(`- **Phone:** ${brand.phone}`);
  if (facts.length) { lines.push('## At a glance', ...facts, ''); }

  if (Array.isArray(brand.services) && brand.services.length) {
    lines.push('## Services');
    for (const s of brand.services) lines.push(`- ${s}`);
    lines.push('');
  }

  lines.push('## Key pages');
  lines.push(`- [Home](${root}/)`);
  lines.push(`- [Blog](${root}/blog)`);
  lines.push(`- [Terms](${root}/terms)`);
  lines.push(`- [Privacy](${root}/privacy)`);
  lines.push('');

  if (req.db) {
    try {
      const pages = await req.db.collection('pages').find({ status: 'published' })
        .project({ slug: 1, title: 1, metaDescription: 1 }).toArray();
      if (pages.length) {
        lines.push('## Pages');
        for (const p of pages) {
          const summary = p.metaDescription ? `: ${p.metaDescription}` : '';
          lines.push(`- [${p.title}](${root}/${p.slug})${summary}`);
        }
        lines.push('');
      }
      const posts = await req.db.collection('blog').find({ status: 'published' })
        .project({ slug: 1, title: 1, excerpt: 1, publishedAt: 1 })
        .sort({ publishedAt: -1 }).limit(25).toArray();
      if (posts.length) {
        lines.push('## Recent posts');
        for (const p of posts) {
          const summary = p.excerpt ? `: ${p.excerpt}` : '';
          lines.push(`- [${p.title}](${root}/blog/${p.slug})${summary}`);
        }
        lines.push('');
      }
    } catch (err) {
      console.warn('[seo] llms.txt collection read failed:', err.message);
    }
  }

  if (brand.socialLinks && typeof brand.socialLinks === 'object') {
    const social = Object.entries(brand.socialLinks).filter(([, v]) => typeof v === 'string' && v.startsWith('http'));
    if (social.length) {
      lines.push('## Social');
      for (const [k, v] of social) lines.push(`- ${k}: ${v}`);
      lines.push('');
    }
  }

  res.send(lines.join('\n'));
});

export default router;
