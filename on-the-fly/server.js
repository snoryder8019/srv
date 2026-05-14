// on-the-fly — Colorado fly fishing aggregator
// Reads /srv/on-the-fly/config/on-the-fly.conf for runtime config
// Aggregates: USGS flows, NOAA weather, hatch calendar
// CPW stocking: scraper stub (CPW has no public API)

import express from 'express';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ────────────────────────────────────────────────────────────
// Config loader (INI-ish format from on-the-fly.conf)
// ────────────────────────────────────────────────────────────
function loadConfig() {
  const conf = fs.readFileSync(path.join(__dirname, 'config/on-the-fly.conf'), 'utf8');
  const out = { gauges: [], weather: [] };
  let section = null;
  for (const rawLine of conf.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      continue;
    }
    if (!section) {
      const eq = line.indexOf('=');
      if (eq > -1) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      continue;
    }
    if (section === 'gauges') {
      const [id, label, river, reach] = line.split('|');
      if (id && label) out.gauges.push({ id, label, river, reach });
    } else if (section === 'weather') {
      const [coords, label] = line.split('|');
      if (coords && label) {
        const [lat, lon] = coords.split(',').map(Number);
        out.weather.push({ lat, lon, label });
      }
    }
  }
  return out;
}

const config = loadConfig();
const PORT = parseInt(config.PORT || 3650, 10);

// ────────────────────────────────────────────────────────────
// In-memory cache (resets on restart, refilled by cron)
// ────────────────────────────────────────────────────────────
const cache = {
  flows: { data: [], updated: null },
  weather: { data: [], updated: null },
  stocking: { data: [], updated: null },
  hatches: null,
};

// ────────────────────────────────────────────────────────────
// USGS flows — free, no key
// ────────────────────────────────────────────────────────────
async function fetchFlows() {
  const ids = config.gauges.map((g) => g.id).join(',');
  const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${ids}&format=json&parameterCd=00060,00010&siteStatus=active`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'on-the-fly/0.1 (madladslab.com)' } });
    if (!res.ok) throw new Error(`USGS ${res.status}`);
    const json = await res.json();
    const byId = {};
    for (const ts of json.value?.timeSeries || []) {
      const siteCode = ts.sourceInfo?.siteCode?.[0]?.value;
      const variable = ts.variable?.variableCode?.[0]?.value; // 00060=cfs, 00010=temp C
      const latest = ts.values?.[0]?.value?.slice(-1)?.[0];
      if (!siteCode || !latest) continue;
      byId[siteCode] = byId[siteCode] || { id: siteCode };
      const val = parseFloat(latest.value);
      if (variable === '00060') {
        byId[siteCode].cfs = val;
        byId[siteCode].cfs_time = latest.dateTime;
      } else if (variable === '00010') {
        byId[siteCode].temp_c = val;
        byId[siteCode].temp_f = val * 9 / 5 + 32;
      }
    }
    cache.flows.data = config.gauges.map((g) => ({ ...g, ...(byId[g.id] || {}) }));
    cache.flows.updated = new Date().toISOString();
    console.log(`[flows] refreshed ${cache.flows.data.length} gauges`);
  } catch (err) {
    console.error('[flows] fetch failed:', err.message);
  }
}

// ────────────────────────────────────────────────────────────
// NOAA weather — free, no key. Two-step: points → forecast
// ────────────────────────────────────────────────────────────
async function fetchWeatherFor(point) {
  try {
    const ptRes = await fetch(`https://api.weather.gov/points/${point.lat},${point.lon}`, {
      headers: { 'User-Agent': 'on-the-fly/0.1 (madladslab.com)', Accept: 'application/geo+json' },
    });
    if (!ptRes.ok) throw new Error(`points ${ptRes.status}`);
    const ptJson = await ptRes.json();
    const fcUrl = ptJson.properties?.forecast;
    if (!fcUrl) throw new Error('no forecast url');
    const fcRes = await fetch(fcUrl, {
      headers: { 'User-Agent': 'on-the-fly/0.1 (madladslab.com)', Accept: 'application/geo+json' },
    });
    if (!fcRes.ok) throw new Error(`forecast ${fcRes.status}`);
    const fcJson = await fcRes.json();
    const periods = fcJson.properties?.periods?.slice(0, 4) || [];
    return { ...point, periods };
  } catch (err) {
    console.error(`[weather] ${point.label}:`, err.message);
    return { ...point, error: err.message };
  }
}

async function fetchWeather() {
  const results = [];
  for (const pt of config.weather) {
    results.push(await fetchWeatherFor(pt));
    await new Promise((r) => setTimeout(r, 250)); // be polite to NOAA
  }
  cache.weather.data = results;
  cache.weather.updated = new Date().toISOString();
  console.log(`[weather] refreshed ${results.length} points`);
}

// ────────────────────────────────────────────────────────────
// CPW stocking — no public API. Stub for future scraper.
// ────────────────────────────────────────────────────────────
async function fetchStocking() {
  cache.stocking.data = [];
  cache.stocking.updated = new Date().toISOString();
  cache.stocking.note =
    'CPW has no public stocking API. Scraper TBD: https://cpw.state.co.us/thingstodo/Pages/StockingReport.aspx';
}

// ────────────────────────────────────────────────────────────
// Hatch calendar (static JSON, current month)
// ────────────────────────────────────────────────────────────
function loadHatches() {
  const p = path.join(__dirname, config.hatch_data || 'data/hatches.json');
  cache.hatches = JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ────────────────────────────────────────────────────────────
// Express app
// ────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/flows', (_, res) => res.json(cache.flows));
app.get('/api/weather', (_, res) => res.json(cache.weather));
app.get('/api/stocking', (_, res) => res.json(cache.stocking));
app.get('/api/hatches', (_, res) => {
  const m = new Date().getMonth() + 1;
  res.json({
    current_month: cache.hatches?.months?.[m] || null,
    all: cache.hatches?.months || {},
  });
});
app.get('/api/all', (_, res) => {
  const m = new Date().getMonth() + 1;
  res.json({
    flows: cache.flows,
    weather: cache.weather,
    stocking: cache.stocking,
    hatches_now: cache.hatches?.months?.[m] || null,
    generated: new Date().toISOString(),
  });
});
app.get('/healthz', (_, res) => res.json({ ok: true, port: PORT }));

// ────────────────────────────────────────────────────────────
// Boot + cron
// ────────────────────────────────────────────────────────────
async function boot() {
  loadHatches();
  await Promise.all([fetchFlows(), fetchWeather(), fetchStocking()]);

  cron.schedule(config.flows_cron || '*/15 * * * *', fetchFlows);
  cron.schedule(config.weather_cron || '0 */1 * * *', fetchWeather);
  cron.schedule(config.stocking_cron || '0 6 * * *', fetchStocking);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[on-the-fly] listening on 0.0.0.0:${PORT}`);
  });
}

boot().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
