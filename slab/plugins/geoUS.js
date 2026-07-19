/**
 * sLab — offline US geocoder for the /network map.
 *
 * Turns the messy, human-typed location strings we already collect
 * ("Austin, TX", "austin texas", "Greater Chicago Area", "TX", "Remote") into
 * an x/y pixel inside the 960×600 SVG basemap that views/partials/us-map.ejs
 * draws — with NO API key, NO network call, and NO runtime dependency.
 *
 * How it works
 * ------------
 * data/us-geo.json (built by scripts/gen-us-geo.mjs) holds ~29.6k US cities and
 * all 51 state outlines, each ALREADY projected through the same d3 geoAlbersUsa
 * projection used to draw the map. So resolving a location is a string parse
 * plus a hash lookup — microseconds, and the answer is a pixel, not a lat/lng.
 *
 * Because the coordinates are baked against one specific projection, this module
 * and the basemap partial are a matched pair. Regenerate both together.
 *
 * Precision is always reported, never guessed at:
 *   'city'  — matched an actual city  → pin sits on the city
 *   'state' — only a state was found  → pin sits on the state centroid
 *   null    — unresolvable            → caller should count it, not plot it
 *
 * International is deliberately out of scope (see NON_US): we detect it and say
 * so, rather than silently dropping it or jamming a foreign city onto a US map.
 * When the network goes international, add a world basemap + a second table and
 * branch on `resolveLocation().scope`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'us-geo.json');

// ── Table load (lazy + memoised; ~644KB parsed once per process) ─────────────
let _geo = null;
let _cityIndex = null;   // "st|cityname" → [x, y]

function geo() {
  if (_geo) return _geo;
  try {
    _geo = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    // Never take the hub down over a missing basemap — degrade to "no pins".
    console.error('[geoUS] could not load data/us-geo.json — run `node scripts/gen-us-geo.mjs`:', err.message);
    _geo = { version: 0, width: 960, height: 600, states: [], cities: {} };
  }
  return _geo;
}

function cityIndex() {
  if (_cityIndex) return _cityIndex;
  _cityIndex = new Map();
  const c = geo().cities || {};
  for (const st of Object.keys(c)) {
    for (const [name, x, y] of c[st]) _cityIndex.set(st + '|' + norm(name), [x, y]);
  }
  return _cityIndex;
}

/** The 51 state outlines + centroids, for the basemap partial. */
export function stateShapes() { return geo().states || []; }
export function mapSize() { const g = geo(); return { width: g.width || 960, height: g.height || 600 }; }

// ── Name tables ─────────────────────────────────────────────────────────────
const STATE_NAMES = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO',
  connecticut:'CT', delaware:'DE', 'district of columbia':'DC', 'washington dc':'DC', 'washington d c':'DC',
  florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA',
  kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA',
  michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE',
  nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY',
  'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
  pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD',
  tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA',
  'west virginia':'WV', wisconsin:'WI', wyoming:'WY',
};
const STATE_ABBRS = new Set(Object.values(STATE_NAMES));
const STATE_LABEL = Object.fromEntries(Object.entries(STATE_NAMES).map(([n, a]) => [a, n.replace(/\b\w/g, c => c.toUpperCase())]));
STATE_LABEL.DC = 'District of Columbia';

/** Strings that carry no place at all — common in free-text location fields. */
const NON_PLACE = new Set([
  'remote', 'remote us', 'fully remote', 'anywhere', 'worldwide', 'global', 'online',
  'n a', 'na', 'none', 'tbd', 'unknown', 'various', 'multiple', 'nationwide',
  'usa', 'us', 'u s', 'u s a', 'united states', 'united states of america', 'america',
]);

/** Enough to say "this is abroad" rather than "this is nowhere". Not exhaustive. */
const NON_US = new Set([
  'canada','mexico','uk','united kingdom','england','scotland','wales','ireland','france','germany',
  'spain','portugal','italy','netherlands','belgium','switzerland','austria','sweden','norway',
  'denmark','finland','poland','czechia','czech republic','greece','turkey','russia','ukraine',
  'india','china','japan','south korea','singapore','malaysia','thailand','vietnam','philippines',
  'indonesia','australia','new zealand','brazil','argentina','chile','colombia','peru',
  'south africa','nigeria','kenya','egypt','israel','uae','united arab emirates','dubai','qatar','saudi arabia',
  'toronto','vancouver','montreal','london','paris','berlin','madrid','rome','amsterdam','dublin',
  'sydney','melbourne','tokyo','seoul','mumbai','bangalore','delhi','shanghai','hong kong','tel aviv',
]);

/** Noise that wraps a real place name: "Greater Austin Area", "Austin Metro". */
const FILLER = /\b(greater|metro|metropolitan|area|region|county|city of|downtown|suburbs?|and surrounding)\b/g;

/** lowercase, de-accent, strip punctuation, collapse space. */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "TX" | "texas" → 'TX', else null. */
export function toStateAbbr(s) {
  const n = norm(s);
  if (!n) return null;
  const up = n.toUpperCase();
  if (up.length === 2 && STATE_ABBRS.has(up)) return up;
  return STATE_NAMES[n] || null;
}

function stateCentroid(abbr) {
  const st = (geo().states || []).find(s => s.abbr === abbr);
  return st ? [st.cx, st.cy] : null;
}

/**
 * The gazetteer spells names out ("Saint Louis", "Fort Worth", "Mount Vernon")
 * but humans type "St. Louis" / "Ft Worth". norm() has already dropped the dot,
 * so expand the leading abbreviation and try both spellings.
 */
const ABBREV = [[/^st /, 'saint '], [/^ft /, 'fort '], [/^mt /, 'mount '], [/^pt /, 'port ']];
function cityVariants(name) {
  const n = norm(name);
  if (!n) return [];
  const out = [n];
  for (const [re, full] of ABBREV) if (re.test(n)) out.push(n.replace(re, full));
  return out;
}

function lookupCity(abbr, cityName) {
  for (const v of cityVariants(cityName)) {
    const hit = cityIndex().get(abbr + '|' + v);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve a free-text location to a point on the US basemap.
 *
 * @param {string} text          e.g. "Austin, TX" / "Texas" / "Greater Chicago Area"
 * @param {object} [opts]
 * @param {string} [opts.state]  known state (abbr or name) — wins over parsing, and
 *                               lets a bare city like "Austin" resolve unambiguously
 * @returns {{x,y,state,label,precision,scope}|{scope}} scope: 'us' | 'international' | 'unknown'
 */
export function resolveLocation(text, opts = {}) {
  const hint = toStateAbbr(opts.state);
  let n = norm(text);

  // A known state + a city string is the easy, high-confidence path (delegates).
  if (hint) {
    const cityPart = n.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
    if (cityPart && !NON_PLACE.has(cityPart)) {
      const hit = lookupCity(hint, cityPart);
      if (hit) return point(hit, hint, titleCase(cityPart) + ', ' + hint, 'city');
    }
    const c = stateCentroid(hint);
    if (c) return point(c, hint, STATE_LABEL[hint] || hint, 'state');
  }

  if (!n) return { scope: 'unknown' };

  // Drop a trailing country, and bail early if it's clearly abroad.
  n = n.replace(/,?\s*(usa|us|u s a|united states( of america)?)\s*$/,'').trim();
  if (!n || NON_PLACE.has(n)) return { scope: 'unknown' };
  const parts = n.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.some(p => NON_US.has(p))) return { scope: 'international' };

  // Strip zips ("Austin, TX 78701") and filler ("Greater Austin Area").
  const clean = parts.map(p => p.replace(/\b\d{5}(-\d{4})?\b/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!clean.length) return { scope: 'unknown' };

  // "City, ST" — the overwhelmingly common shape.
  if (clean.length >= 2) {
    const st = toStateAbbr(clean[clean.length - 1]);
    if (st) {
      const city = clean[clean.length - 2];
      const hit = lookupCity(st, city);
      if (hit) return point(hit, st, titleCase(city) + ', ' + st, 'city');
      const c = stateCentroid(st);
      if (c) return point(c, st, STATE_LABEL[st] || st, 'state');
    }
  }

  // A bare state: "Texas" / "TX".
  const only = toStateAbbr(clean[clean.length - 1]) || toStateAbbr(clean[0]);
  if (only && clean.length === 1) {
    const c = stateCentroid(only);
    if (c) return point(c, only, STATE_LABEL[only] || only, 'state');
  }

  // "Austin TX" with no comma — last token may be the state.
  for (const seg of clean) {
    const toks = seg.split(' ');
    if (toks.length >= 2) {
      const st = toStateAbbr(toks[toks.length - 1]) || toStateAbbr(toks.slice(-2).join(' '));
      if (st) {
        const city = toks.slice(0, st === toStateAbbr(toks.slice(-2).join(' ')) ? -2 : -1).join(' ');
        const hit = city && lookupCity(st, city);
        if (hit) return point(hit, st, titleCase(city) + ', ' + st, 'city');
        const c = stateCentroid(st);
        if (c) return point(c, st, STATE_LABEL[st] || st, 'state');
      }
    }
  }

  // Last resort: a city name unique enough to appear in exactly one state.
  const uniq = uniqueCity(clean[0]);
  if (uniq) return point([uniq.x, uniq.y], uniq.state, titleCase(clean[0]) + ', ' + uniq.state, 'city');

  return { scope: 'unknown' };
}

/** A bare city name only counts if exactly one state has it (avoids the 30 Springfields). */
function uniqueCity(name) {
  const keys = cityVariants(name);
  if (!keys.length) return null;
  let found = null;
  for (const [k, v] of cityIndex()) {
    if (!keys.includes(k.slice(3))) continue;
    if (found) return null;                 // ambiguous → refuse to guess
    found = { state: k.slice(0, 2), x: v[0], y: v[1] };
  }
  return found;
}

function point([x, y], state, label, precision) {
  return { x, y, state, label, precision, scope: 'us' };
}

function titleCase(s) {
  return String(s).replace(/\b[a-z]/g, c => c.toUpperCase());
}

/**
 * Spread pins that resolved to the exact same pixel (very common: everyone in a
 * state with no city lands on the centroid). Walks a small spiral so clusters
 * stay legible without moving anyone meaningfully far from the truth.
 * Mutates and returns the list.
 */
export function dispersePins(pins, { radius = 7 } = {}) {
  const buckets = new Map();
  for (const p of pins) {
    const k = p.x + ':' + p.y;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    group.forEach((p, i) => {
      if (i === 0) return;
      const r = radius * Math.sqrt(i);
      const a = i * GOLDEN;
      p.x = Math.round(p.x + r * Math.cos(a));
      p.y = Math.round(p.y + r * Math.sin(a));
      p.dispersed = true;
    });
  }
  return pins;
}
