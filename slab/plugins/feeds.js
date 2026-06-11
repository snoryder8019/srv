// Syndication feed builders — RSS 2.0 and Atom 1.0 — for Writer content
// (blog posts, newsletter issues, help articles). Pure string builders with no
// DB/Express coupling: routes pass already-fetched items + absolute URLs.
//
// Each item: { title, url, excerpt, content, category, publishedAt, updatedAt }
//   url  — absolute permalink (https://domain/<base>/<slug>)
//   content — full HTML body (optional; emitted as content:encoded / content)
//
// Used by routes/index.js — GET /<base>/feed.rss and /<base>/feed.atom.

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// CDATA-wrap rich HTML so we don't have to entity-escape the whole body. The
// split guards against a literal "]]>" prematurely closing the section.
function cdata(s) {
  return `<![CDATA[${String(s == null ? '' : s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function toDate(v, fallback) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d : fallback;
}

/**
 * RSS 2.0 feed.
 * @param {object} o
 * @param {string} o.title        channel title
 * @param {string} o.description  channel description
 * @param {string} o.siteUrl      absolute site/section URL (channel <link>)
 * @param {string} o.feedUrl      absolute URL of this feed (atom:link self)
 * @param {Date}   o.now          current time (passed in — Date.now() is unavailable in some contexts)
 * @param {Array}  o.items        feed items
 */
export function buildRssFeed({ title, description, siteUrl, feedUrl, now = new Date(), items = [] }) {
  const built = now.toUTCString();
  const body = items.map((it) => {
    const link = it.url;
    const pub = toDate(it.publishedAt, now).toUTCString();
    return [
      '    <item>',
      `      <title>${xmlEscape(it.title)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
      `      <pubDate>${pub}</pubDate>`,
      it.category ? `      <category>${xmlEscape(it.category)}</category>` : '',
      `      <description>${cdata(it.excerpt || '')}</description>`,
      it.content ? `      <content:encoded>${cdata(it.content)}</content:encoded>` : '',
      '    </item>',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(siteUrl)}</link>
    <description>${xmlEscape(description)}</description>
    <language>en</language>
    <lastBuildDate>${built}</lastBuildDate>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml"/>
${body}
  </channel>
</rss>`;
}

/**
 * Atom 1.0 feed. Same option shape as buildRssFeed, plus:
 * @param {string} o.authorName  feed-level author (required for valid Atom)
 */
export function buildAtomFeed({ title, description, siteUrl, feedUrl, authorName = '', now = new Date(), items = [] }) {
  const latest = items.length
    ? toDate(items[0].updatedAt || items[0].publishedAt, now)
    : now;
  const body = items.map((it) => {
    const link = it.url;
    const pub = toDate(it.publishedAt, now).toISOString();
    const upd = toDate(it.updatedAt || it.publishedAt, now).toISOString();
    return [
      '  <entry>',
      `    <title>${xmlEscape(it.title)}</title>`,
      `    <link href="${xmlEscape(link)}"/>`,
      `    <id>${xmlEscape(link)}</id>`,
      `    <published>${pub}</published>`,
      `    <updated>${upd}</updated>`,
      it.category ? `    <category term="${xmlEscape(it.category)}"/>` : '',
      `    <summary type="html">${cdata(it.excerpt || '')}</summary>`,
      it.content ? `    <content type="html">${cdata(it.content)}</content>` : '',
      '  </entry>',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(title)}</title>
  <subtitle>${xmlEscape(description)}</subtitle>
  <link href="${xmlEscape(siteUrl)}"/>
  <link href="${xmlEscape(feedUrl)}" rel="self" type="application/atom+xml"/>
  <id>${xmlEscape(feedUrl)}</id>
  <updated>${latest.toISOString()}</updated>
  ${authorName ? `<author><name>${xmlEscape(authorName)}</name></author>` : ''}
${body}
</feed>`;
}
