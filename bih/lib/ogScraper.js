const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

function fetchPage(url, timeout = 6000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    const req = client.get(url, { timeout, headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) {
          const u = new URL(url);
          loc = u.origin + loc;
        }
        return fetchPage(loc, timeout, redirects - 1).then(done).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        // Stop early once we have </head> — all OG meta lives in <head>
        if (data.includes('</head>') || data.length > 800000) {
          res.destroy();
          done(data);
        }
      });
      res.on('end', () => done(data));
    });
    req.on('error', (e) => { if (!resolved) reject(e); });
    req.on('timeout', () => { req.destroy(); if (!resolved) reject(new Error('timeout')); });
  });
}

async function scrapeOG(url) {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const get = (prop) =>
    $(`meta[property="${prop}"]`).attr('content') ||
    $(`meta[name="${prop}"]`).attr('content') || '';

  return {
    url,
    title: get('og:title') || get('twitter:title') || $('title').text().trim() || '',
    description: get('og:description') || get('twitter:description') || get('description') || '',
    image: get('og:image') || get('twitter:image') || '',
    siteName: get('og:site_name') || ''
  };
}

module.exports = { scrapeOG };
