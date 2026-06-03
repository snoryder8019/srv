import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_DIR = path.resolve(__dirname, '..', 'data', 'clients');

let cache = null;

function loadAll() {
  const entries = fs.readdirSync(CLIENTS_DIR).filter((f) => f.endsWith('.json'));
  const out = {};
  for (const file of entries) {
    const slug = file.replace(/\.json$/, '');
    const raw = fs.readFileSync(path.join(CLIENTS_DIR, file), 'utf8');
    out[slug] = JSON.parse(raw);
    out[slug].slug = slug;
  }
  return out;
}

export function getPitch(slug) {
  if (process.env.NODE_ENV !== 'production' || !cache) cache = loadAll();
  return cache[slug] || null;
}

export function listPitches() {
  if (process.env.NODE_ENV !== 'production' || !cache) cache = loadAll();
  return Object.values(cache).map((p) => ({
    slug: p.slug,
    client: p.client,
    industry: p.industry,
    date: p.date,
    summary: p.summary,
  }));
}

export function getView(pitch, viewSlug) {
  if (!pitch?.views) return null;
  return pitch.views.find((v) => v.slug === viewSlug) || null;
}
