/**
 * SEO / AEO / GEO middleware
 *
 * Sets `res.locals.seo` on every request with sane tenant-aware defaults.
 * Views drop in `partials/seo-head.ejs` to render title/meta/OG/JSON-LD.
 * Routes can refine with `res.setSeo({ ... })` before rendering.
 *
 * Header-level signals (X-Robots-Tag, Link canonical, Vary) are also set here.
 */

const PUBLIC_ROBOTS = 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1';
const PRIVATE_ROBOTS = 'noindex,nofollow';

const PRIVATE_PATH_PREFIXES = [
  '/admin', '/superadmin', '/delegates',
  '/auth', '/api', '/webhooks',
  '/start/webhook', '/pay/', '/book/confirm',
];

function isPrivatePath(p) {
  return PRIVATE_PATH_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/') || p.startsWith(pre));
}

function pickBusinessSchemaType(brand) {
  const bt = (brand?.businessType || '').toLowerCase();
  if (bt.includes('restaurant')) return 'Restaurant';
  if (bt.includes('store') || bt.includes('retail') || bt.includes('e-commerce')) return 'OnlineStore';
  if (bt.includes('real estate')) return 'RealEstateAgent';
  if (bt.includes('salon') || bt.includes('spa')) return 'BeautySalon';
  if (bt.includes('fitness') || bt.includes('gym')) return 'SportsActivityLocation';
  if (bt.includes('contractor') || bt.includes('construction')) return 'GeneralContractor';
  if (bt.includes('agency')) return 'Organization';
  if (bt.includes('consult')) return 'ProfessionalService';
  if (brand?.location) return 'LocalBusiness';
  return 'Organization';
}

function buildOrganizationLd(brand, baseUrl, logoUrl) {
  if (!brand?.name) return null;
  const org = {
    '@context': 'https://schema.org',
    '@type': pickBusinessSchemaType(brand),
    name: brand.name,
    url: baseUrl,
  };
  if (logoUrl) org.logo = logoUrl;
  if (brand.tagline) org.slogan = brand.tagline;
  if (brand.description) org.description = brand.description;
  if (brand.email) org.email = brand.email;
  if (brand.phone) org.telephone = brand.phone;
  if (brand.location) {
    org.address = { '@type': 'PostalAddress', addressLocality: brand.location };
  }
  if (brand.serviceArea) org.areaServed = brand.serviceArea;
  if (Array.isArray(brand.services) && brand.services.length) {
    org.makesOffer = brand.services.map(s => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: s },
    }));
  }
  if (brand.socialLinks && typeof brand.socialLinks === 'object') {
    const sameAs = Object.values(brand.socialLinks).filter(v => typeof v === 'string' && v.startsWith('http'));
    if (sameAs.length) org.sameAs = sameAs;
  }
  // ContactPoint — AAO signal so agents know how to reach the business
  if (brand.email || brand.phone) {
    org.contactPoint = [{
      '@type': 'ContactPoint',
      contactType: 'customer service',
      ...(brand.email ? { email: brand.email } : {}),
      ...(brand.phone ? { telephone: brand.phone } : {}),
      ...(brand.serviceArea ? { areaServed: brand.serviceArea } : {}),
      availableLanguage: ['en'],
    }];
  }
  // potentialAction — agents can discover how to act on the site
  org.potentialAction = [
    { '@type': 'CommunicateAction', target: `${baseUrl}/start`, name: 'Get started' },
    ...(brand.email ? [{ '@type': 'CommunicateAction', target: `mailto:${brand.email}`, name: 'Email' }] : []),
  ];
  return org;
}

function buildWebsiteLd(brand, baseUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: brand?.name || 'Slab',
    url: baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${baseUrl}/blog?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

function isSoftwareBusiness(brand) {
  const bt = (brand?.businessType || '').toLowerCase();
  const ind = (brand?.industry || '').toLowerCase();
  return /platform|saas|software|app|api|tech/.test(bt) ||
         /saas|software|technology|cloud|developer/.test(ind);
}

function buildSoftwareApplicationLd(brand, baseUrl, logoUrl) {
  if (!brand?.name || !isSoftwareBusiness(brand)) return null;
  const node = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: brand.name,
    url: baseUrl,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
  };
  if (brand.description) node.description = brand.description;
  if (brand.tagline)     node.alternateName = brand.tagline;
  if (logoUrl)           node.image = logoUrl;
  if (Array.isArray(brand.services) && brand.services.length) {
    node.featureList = brand.services.join(', ');
  }
  if (Array.isArray(brand.pricingTiers) && brand.pricingTiers.length) {
    node.offers = brand.pricingTiers.map(t => ({
      '@type': 'Offer',
      name: t.label || 'Plan',
      price: String(t.amount || '0').replace(/[^0-9.]/g, '') || '0',
      priceCurrency: t.currency || 'USD',
      ...(t.unit ? { description: t.unit } : {}),
    }));
  }
  return node;
}

function buildFaqLd(brand) {
  const faq = Array.isArray(brand?.faq) ? brand.faq : null;
  if (!faq || !faq.length) return null;
  const entries = faq
    .filter(q => q && q.question && q.answer)
    .map(q => ({
      '@type': 'Question',
      name: String(q.question),
      acceptedAnswer: { '@type': 'Answer', text: String(q.answer) },
    }));
  if (!entries.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries,
  };
}

export function seoMiddleware(req, res, next) {
  const host = req.hostname;
  const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const baseUrl = `${proto}://${host}`;
  const canonical = `${baseUrl}${req.originalUrl.split('?')[0]}`;

  const tenant = req.tenant;
  const brand = tenant?.brand || res.locals.brand || {};
  const isPreview = tenant?.isPreview || tenant?.status === 'preview';
  const privateArea = isPrivatePath(req.path);
  // HEAD requests get the same indexability signals as GET — crawlers use HEAD
  // for freshness checks and a noindex header here would be read as authoritative.
  const isCrawlable = (req.method === 'GET' || req.method === 'HEAD') && !privateArea && !isPreview;

  const robots = isCrawlable ? PUBLIC_ROBOTS : PRIVATE_ROBOTS;

  // Header-level signals
  if (!isCrawlable) res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Vary', 'Accept-Encoding, User-Agent');
  if (isCrawlable) {
    res.set('Link', `<${canonical}>; rel="canonical"`);
  }

  const title = brand?.name
    ? (brand.tagline ? `${brand.name} — ${brand.tagline}` : brand.name)
    : 'Slab';
  const description = brand?.description || brand?.tagline || '';

  const jsonLd = [];
  jsonLd.push(buildWebsiteLd(brand, baseUrl));
  const org = buildOrganizationLd(brand, baseUrl, null);
  if (org) jsonLd.push(org);
  const softwareApp = buildSoftwareApplicationLd(brand, baseUrl, null);
  if (softwareApp) jsonLd.push(softwareApp);
  const faq = buildFaqLd(brand);
  if (faq) jsonLd.push(faq);

  res.locals.seo = {
    title,
    description,
    canonical,
    robots,
    ogType: 'website',
    ogImage: '',
    twitterCard: 'summary_large_image',
    twitterSite: brand?.socialLinks?.twitter || '',
    locale: 'en_US',
    siteName: brand?.name || 'Slab',
    baseUrl,
    themeColor: '',
    jsonLd,
  };

  res.setSeo = (overrides) => {
    if (!overrides) return;
    const cur = res.locals.seo;
    if (Array.isArray(overrides.jsonLd)) {
      cur.jsonLd = [...cur.jsonLd, ...overrides.jsonLd];
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (k === 'jsonLd') continue;
      if (v === undefined || v === null || v === '') continue;
      cur[k] = v;
    }
  };

  next();
}
