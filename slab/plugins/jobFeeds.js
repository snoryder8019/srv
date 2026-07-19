// Careers syndication + structured-data builders.
//
// Three outputs, all pure string/object builders (no DB/Express coupling —
// routes pass already-fetched job docs + absolute URLs):
//
//   buildJobPostingLd()  — schema.org JobPosting JSON-LD for one posting. This
//                          is what gets a role into Google Jobs. Emitted inline
//                          in the public detail page's <head>.
//   buildJobListLd()     — an ItemList of JobPostings for the /careers index.
//   buildJobFeedXml()     — the Indeed "XML feed" (a.k.a. source file) that
//                          Indeed / ZipRecruiter / many boards ingest by URL.
//                          Also serviceable as a generic job XML feed.
//
// Used by routes/careers.js — GET /careers/:slug (LD), /careers (LD),
// and GET /careers/feed.xml (Indeed).

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cdata(s) {
  return `<![CDATA[${String(s == null ? '' : s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function toDate(v, fallback) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d : fallback;
}

// schema.org employmentType enum (Google Jobs).
const GOOGLE_EMPLOYMENT = {
  'full-time': 'FULL_TIME',
  'part-time': 'PART_TIME',
  'contract': 'CONTRACTOR',
  'temporary': 'TEMPORARY',
  'internship': 'INTERN',
};
export function googleEmploymentType(t) {
  return GOOGLE_EMPLOYMENT[t] || 'OTHER';
}

// Indeed <jobtype> vocabulary.
const INDEED_JOBTYPE = {
  'full-time': 'fulltime',
  'part-time': 'parttime',
  'contract': 'contract',
  'temporary': 'temporary',
  'internship': 'internship',
};

// Best-effort "City, ST" / "City, ST, Country" split from the free-text location.
export function parseLocation(loc) {
  const parts = String(loc || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { city: '', region: '', country: '' };
  if (parts.length === 1) return { city: parts[0], region: '', country: '' };
  if (parts.length === 2) return { city: parts[0], region: parts[1], country: '' };
  return { city: parts[0], region: parts[1], country: parts.slice(2).join(', ') };
}

// Resolve a posting's location to structured parts. Prefers the explicit
// city/region/country/postalCode fields (added to the posting form); falls back
// to parsing the legacy free-text `location` string so old docs still emit a
// valid address. Returns { city, region, country, postalCode }.
export function jobLocationParts(job) {
  const hasStructured = job.city || job.region || job.country || job.postalCode;
  if (hasStructured) {
    return {
      city: job.city || '', region: job.region || '',
      country: job.country || '', postalCode: job.postalCode || '',
    };
  }
  return { ...parseLocation(job.location), postalCode: '' };
}

// A single display string for the location, honoring structured fields.
export function jobLocationDisplay(job) {
  const { city, region, country } = jobLocationParts(job);
  return [city, region, country].filter(Boolean).join(', ');
}

function salaryText(job) {
  const { salaryMin, salaryMax, salaryCurrency } = job;
  if (!salaryMin && !salaryMax) return '';
  const cur = salaryCurrency || 'USD';
  const fmt = (n) => Number(n).toLocaleString();
  if (salaryMin && salaryMax) return `${cur} ${fmt(salaryMin)} - ${fmt(salaryMax)}`;
  return `${cur} ${fmt(salaryMin || salaryMax)}`;
}

/**
 * schema.org JobPosting for a single role. Returns a plain object — the caller
 * JSON.stringifies it into a <script type="application/ld+json">.
 *
 * @param {object}  o
 * @param {object}  o.job          the job doc (title, description, dates, salary…)
 * @param {string}  o.brandName    hiring organization name
 * @param {string}  o.siteOrigin   https://host (no trailing slash)
 * @param {string}  o.jobUrl       absolute permalink to the posting
 * @param {string} [o.logoUrl]     absolute org logo URL
 */
export function buildJobPostingLd({ job, brandName, siteOrigin, jobUrl, logoUrl = '' }) {
  const posted = toDate(job.publishedAt || job.createdAt, new Date());
  const { city, region, country, postalCode } = jobLocationParts(job);
  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description || job.title,
    datePosted: posted.toISOString().slice(0, 10),
    employmentType: googleEmploymentType(job.employmentType),
    hiringOrganization: {
      '@type': 'Organization',
      name: brandName || 'Company',
      sameAs: siteOrigin,
      ...(logoUrl ? { logo: logoUrl } : {}),
    },
    identifier: {
      '@type': 'PropertyValue',
      name: brandName || 'Company',
      value: String(job._id || job.slug),
    },
  };

  if (job.closesAt) {
    const v = toDate(job.closesAt, null);
    if (v) ld.validThrough = v.toISOString();
  }

  // Location. A physical location is required unless the role is remote, in
  // which case Google wants jobLocationType=TELECOMMUTE + an applicant region.
  if (city || region || country || postalCode) {
    ld.jobLocation = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...(city ? { addressLocality: city } : {}),
        ...(region ? { addressRegion: region } : {}),
        ...(postalCode ? { postalCode } : {}),
        ...(country ? { addressCountry: country } : {}),
      },
    };
  }
  if (job.remote) {
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = {
      '@type': 'Country',
      name: country || 'US',
    };
  }

  // baseSalary — only emit when we have real numbers (Google penalizes fabricated
  // ranges). unitText is UNKNOWN unless we can infer; YEAR is the safe default.
  if (job.salaryMin || job.salaryMax) {
    ld.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency || 'USD',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salaryMin ? { minValue: Number(job.salaryMin) } : {}),
        ...(job.salaryMax ? { maxValue: Number(job.salaryMax) } : {}),
        unitText: 'YEAR',
      },
    };
  }

  ld.url = jobUrl;
  ld.directApply = (job.applyMode || 'internal') === 'internal';
  return ld;
}

/** ItemList of JobPostings for the careers index page. */
export function buildJobListLd({ jobs, siteOrigin, brandName }) {
  return {
    '@context': 'https://schema.org/',
    '@type': 'ItemList',
    name: `${brandName || 'Company'} — Open Positions`,
    itemListElement: jobs.map((j, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${siteOrigin}/careers/${j.slug}`,
      name: j.title,
    })),
  };
}

/**
 * XML job feed ("source" file, Indeed-compatible format). Boards poll this URL
 * and ingest every <job>.
 * Spec: https://docs.indeed.com/indeed-apply/xml-feed
 *
 * @param {object}  o
 * @param {Array}   o.jobs          live job docs
 * @param {string}  o.brandName     company name
 * @param {string}  o.siteOrigin    https://host (no trailing slash)
 * @param {string}  o.publisherUrl  publisher/site URL (defaults to siteOrigin)
 * @param {string}  o.contactEmail  account contact email — Indeed marks <email> required
 * @param {Date}    o.now           build timestamp (Date.now() unavailable in some contexts)
 */
export function buildJobFeedXml({ jobs, brandName, siteOrigin, publisherUrl, contactEmail = '', now = new Date() }) {
  const built = now.toUTCString();
  const items = (jobs || []).map((job) => {
    const url = `${siteOrigin}/careers/${job.slug}`;
    const posted = toDate(job.publishedAt || job.createdAt, now);
    const { city, region, country, postalCode } = jobLocationParts(job);
    const desc = job.description
      || [job.title, (job.requirements || []).join(' '), (job.benefits || []).join(' ')].filter(Boolean).join(' ');
    const sal = salaryText(job);
    // Indeed marks referencenumber AND requisitionid as required; we have one
    // stable id (the doc _id), so use it for both unless a distinct requisitionId
    // is set on the job. expirationdate comes from closesAt when present.
    const refId = String(job._id || job.slug);
    const reqId = String(job.requisitionId || job._id || job.slug);
    const expires = job.closesAt ? toDate(job.closesAt, null) : null;
    const lines = [
      '  <job>',
      `    <title>${cdata(job.title)}</title>`,
      `    <date>${cdata(posted.toUTCString())}</date>`,
      `    <referencenumber>${cdata(refId)}</referencenumber>`,
      `    <requisitionid>${cdata(reqId)}</requisitionid>`,
      `    <url>${cdata(url)}</url>`,
      `    <company>${cdata(brandName || '')}</company>`,
      contactEmail ? `    <email>${cdata(contactEmail)}</email>` : '',
      city ? `    <city>${cdata(city)}</city>` : '',
      region ? `    <state>${cdata(region)}</state>` : '',
      country ? `    <country>${cdata(country)}</country>` : '',
      postalCode ? `    <postalcode>${cdata(postalCode)}</postalcode>` : '',
      job.department ? `    <category>${cdata(job.department)}</category>` : '',
      `    <jobtype>${cdata(INDEED_JOBTYPE[job.employmentType] || 'fulltime')}</jobtype>`,
      job.remote ? `    <remotetype>${cdata('Fully remote')}</remotetype>` : '',
      sal ? `    <salary>${cdata(sal)}</salary>` : '',
      expires ? `    <expirationdate>${cdata(expires.toISOString().slice(0, 10))}</expirationdate>` : '',
      `    <description>${cdata(desc)}</description>`,
      '  </job>',
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<source>
  <publisher>${xmlEscape(brandName || '')}</publisher>
  <publisherurl>${xmlEscape(publisherUrl || siteOrigin)}</publisherurl>
  <lastBuildDate>${xmlEscape(built)}</lastBuildDate>
${items}
</source>`;
}
