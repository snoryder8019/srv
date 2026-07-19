/**
 * Build-time generator for data/us-geo.json — the offline US geo table that
 * powers the /network map. Run this ONCE (or when you want to refresh the
 * basemap); the app never runs it and never calls a geocoding API.
 *
 *   node scripts/gen-us-geo.mjs
 *
 * Why bake coordinates?
 * ---------------------
 * The map is a static SVG in a fixed 960×600 viewBox. Rather than ship a
 * projection library to the browser (or the server), we project EVERY city and
 * state centroid through the SAME d3 geoAlbersUsa projection used to draw the
 * state outlines, and store the resulting x/y pixel directly. At runtime a pin
 * is a table lookup — no math, no dependencies, no network.
 *
 * That also means: the projection here and the state paths here are a matched
 * pair. Never regenerate one without the other, or pins will drift off the map.
 *
 * Build deps are installed to a temp dir so they never enter slab's package.json.
 *
 * Sources:
 *   us-atlas (Natural Earth / US Census) — state boundaries, public domain
 *   kelvins/US-Cities-Database — city lat/lng gazetteer, MIT
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as topojson from 'topojson-client';
import * as simplify from 'topojson-simplify';
import { geoAlbersUsa, geoPath } from 'd3-geo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'us-geo.json');
const BUILD = process.env.GEO_BUILD_DIR || '/tmp/slab-geo-build';

const W = 960, H = 600;
const SIMPLIFY_WEIGHT = 0.05;   // tuned: ~23KB of path data, still recognisable at 960px

// FIPS → USPS. Territories (PR, VI, GU…) are intentionally absent: geoAlbersUsa
// has no room for them and returns null, so they'd be dropped anyway.
const FIPS = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL',
  '13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME',
  '24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH',
  '34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY',
};
const VALID_ST = new Set(Object.values(FIPS));

const atlas = path.join(BUILD, 'node_modules', 'us-atlas', 'states-10m.json');
const csv = path.join(BUILD, 'us_cities.csv');
if (!fs.existsSync(atlas) || !fs.existsSync(csv)) {
  console.error(`Missing build inputs in ${BUILD}. Run the install/fetch step first — see the header of this file.`);
  process.exit(1);
}

// ── Basemap: simplify first, then fit the projection to what we actually draw ──
const raw = JSON.parse(fs.readFileSync(atlas, 'utf8'));
const topo = simplify.simplify(simplify.presimplify(raw), SIMPLIFY_WEIGHT);
const fc = topojson.feature(topo, topo.objects.states);
const proj = geoAlbersUsa().fitSize([W, H], fc);
const geoPathGen = geoPath(proj);

const trim = (d) => d.replace(/-?\d+\.\d+/g, (m) => String(Math.round(parseFloat(m) * 10) / 10));

const states = [];
for (const f of fc.features) {
  const abbr = FIPS[f.id];
  if (!abbr) continue;
  const d = geoPathGen(f);
  if (!d) continue;
  const [cx, cy] = geoPathGen.centroid(f);
  states.push({ abbr, name: f.properties.name, d: trim(d), cx: Math.round(cx), cy: Math.round(cy) });
}
states.sort((a, b) => a.abbr.localeCompare(b.abbr));

// ── Cities: project each to pixel space, dedupe on state+name ──
const cities = {};
let kept = 0, skipped = 0;
const seen = new Set();
const lines = fs.readFileSync(csv, 'utf8').split('\n').slice(1);
for (const line of lines) {
  // ID,STATE_CODE,STATE_NAME,CITY,COUNTY,LATITUDE,LONGITUDE  (CITY/COUNTY may be quoted)
  const m = line.trim().match(/^(\d+),([A-Z]{2}),([^,]+),("[^"]*"|[^,]*),("[^"]*"|[^,]*),(-?[\d.]+),(-?[\d.]+)$/);
  if (!m) { skipped++; continue; }
  const st = m[2];
  const city = m[4].replace(/^"|"$/g, '').trim();
  const lat = parseFloat(m[6]), lng = parseFloat(m[7]);
  if (!city || !VALID_ST.has(st) || !isFinite(lat) || !isFinite(lng)) { skipped++; continue; }
  const key = st + '|' + city.toLowerCase();
  if (seen.has(key)) continue;
  const p = proj([lng, lat]);
  if (!p) { skipped++; continue; }     // clipped out of Albers USA
  seen.add(key);
  (cities[st] ||= []).push([city, Math.round(p[0]), Math.round(p[1])]);
  kept++;
}
for (const st of Object.keys(cities)) cities[st].sort((a, b) => a[0].localeCompare(b[0]));

const out = {
  version: 1,
  generated: new Date().toISOString(),
  projection: 'd3-geo geoAlbersUsa, fitSize',
  width: W,
  height: H,
  simplifyWeight: SIMPLIFY_WEIGHT,
  states,
  cities,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));

// ── Self-check: known landmarks must land in sane pixels ──
const probes = [['Austin','TX'],['New York','NY'],['Anchorage','AK'],['Honolulu','HI'],['Seattle','WA'],['Miami','FL']];
console.log(`states: ${states.length}  cities: ${kept} (skipped ${skipped})  → ${OUT} (${(fs.statSync(OUT).size/1024).toFixed(0)} KB)`);
for (const [c, st] of probes) {
  const hit = (cities[st] || []).find(x => x[0].toLowerCase() === c.toLowerCase());
  console.log(`  probe ${c}, ${st} → ${hit ? `x=${hit[1]} y=${hit[2]}` : 'MISS'}`);
}
if (states.length !== 51) { console.error('EXPECTED 51 states (50 + DC)'); process.exit(1); }
