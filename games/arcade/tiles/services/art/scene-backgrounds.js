/**
 * SD-generated SCENE backgrounds for the tiles 3D table.
 *
 * The shared table core (public/js/table3d.js) renders a flat color behind the
 * felt by default. When a scene image exists for a variant we hand its URL to
 * createTable3D({ bgImage|bgScene }) and three.js draws it as the full-screen,
 * screen-PINNED, cover-fit backdrop.
 *
 * Mirrors /srv/td/services/art/card-backgrounds.js: generate OFFLINE (dev
 * endpoint or cron), one or two per run, lock so overlapping ticks never
 * double-generate, write a PNG + a manifest the client/catalog can read.
 *
 *   image  -> public/img/scenes/<slug>.png   (served at /static/img/scenes/<slug>.png)
 *   record -> public/img/scenes/manifest.json
 *
 * STYLE NOTE: backdrops are intentionally QUIET — heavily blurred, muted, low
 * contrast — so they sit behind the table without fighting the game for
 * attention. The shared STYLE suffix below enforces that on every prompt.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', 'public', 'img', 'scenes');
const MANIFEST = path.join(OUT, 'manifest.json');
const LOCK = path.join(OUT, '.lock');
const PUBLIC_BASE = '/static/img/scenes';

// Appended to every prompt: keeps backdrops soft, dark, and non-distracting.
const STYLE = ', heavily blurred, out of focus, defocused, soft bokeh, dark, ' +
  'muted desaturated colors, low contrast, minimal detail, calm ambient backdrop, ' +
  'no focal subject, cinematic depth, dreamy haze';

const NEG = 'sharp focus, in focus, crisp, detailed, busy, cluttered, detailed ' +
  'foreground, bright, vivid, saturated, high contrast, neon glare, harsh light, ' +
  'text, words, letters, watermark, signature, logo, ui, frame, border, table, ' +
  'cards, tiles, dominoes, chips, hands, people, face, jpeg artifacts';

// Scene moods, keyed by slug. `space` / `underwater` / `casino` are the named
// moods; the live variant slugs (dominoes, hearts) point at one by default and
// can be re-pointed any time with POST /dev/scene { slug, prompt }.
export const SCENE_PROMPTS = {
  space: 'distant deep space, faint nebula clouds and sparse stars, vast dark void',
  underwater: 'deep underwater abyss, faint light rays through dark water, drifting particles',
  casino: 'a faraway dim casino interior, distant blurred lights, smoky low light',

  dominoes: 'a faraway dim casino interior, distant blurred lights, smoky low light',
  hearts: 'deep underwater abyss, faint light rays through dark water, drifting particles',
  euchre: 'a faraway dim card lounge, distant warm blurred lights, smoky low light',
  mahjong: 'a faraway dim parlor with distant paper lanterns, soft warm blurred glow',
  craps: 'a faraway dim casino craps pit, distant blurred lights, smoky low light',
  roulette: 'a faraway dim casino floor, distant blurred golden lights, smoky low light',

  default: 'soft dark gradient, faint distant bokeh, deep muted tones, empty atmospheric void',
};

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}
function writeManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

/** The public list of scenes that currently have a rendered image on disk. */
export function listScenes() {
  const m = readManifest();
  return Object.entries(m)
    .filter(([slug]) => fs.existsSync(path.join(OUT, slug + '.png')))
    .map(([slug, rec]) => ({ slug, url: rec.url, at: rec.at }));
}

/** Resolve a scene image URL for a variant slug, or null if none rendered. */
export function sceneUrlFor(slug) {
  if (!slug) return null;
  if (fs.existsSync(path.join(OUT, slug + '.png'))) return `${PUBLIC_BASE}/${slug}.png`;
  return null;
}

/**
 * Generate ONE scene background now and persist it. Returns { ok, slug, url } or
 * { ok:false, error }. Slow (SD) — call from the dev endpoint / cron, not a page
 * load. Custom prompt overrides the registry; the muted STYLE suffix is always
 * appended so backdrops stay quiet (pass opts.raw to skip it).
 */
export async function generateScene(slug, opts = {}) {
  if (!slug || !/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(slug)) {
    return { ok: false, error: 'invalid slug' };
  }
  fs.mkdirSync(OUT, { recursive: true });
  const base = opts.prompt || SCENE_PROMPTS[slug] || SCENE_PROMPTS.default;
  const prompt = opts.raw ? base : base + STYLE;
  const b64 = await generateImage(prompt, {
    size: opts.size || '768x512',
    steps: opts.steps ?? 22,
    negativePrompt: opts.negativePrompt || NEG,
    timeoutMs: opts.timeoutMs ?? 180000,
  });
  if (!b64) return { ok: false, error: 'generation failed (gateway null)' };

  fs.writeFileSync(path.join(OUT, slug + '.png'), Buffer.from(b64, 'base64'));
  const url = `${PUBLIC_BASE}/${slug}.png`;
  const m = readManifest();
  m[slug] = { url, prompt, at: new Date().toISOString() };
  writeManifest(m);
  return { ok: true, slug, url };
}

/**
 * Backfill any default scene that lacks an image — a few per run so a cron
 * gradually populates them without hammering the GPU. Lock guards overlap.
 */
export async function backfillScenes({ limit = 1 } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < 4 * 60 * 1000) return { skipped: 'locked' };
  } catch { /* no lock */ }
  fs.writeFileSync(LOCK, String(Date.now()));

  const result = { generated: 0, failed: 0, remaining: 0, scenes: [] };
  try {
    const need = Object.keys(SCENE_PROMPTS)
      .filter((slug) => slug !== 'default')
      .filter((slug) => !fs.existsSync(path.join(OUT, slug + '.png')));
    for (const slug of need.slice(0, limit)) {
      const r = await generateScene(slug);
      if (r.ok) { result.generated++; result.scenes.push(slug); }
      else result.failed++;
    }
    result.remaining = need.length - result.generated;
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
  }
  return result;
}

export default { listScenes, sceneUrlFor, generateScene, backfillScenes, SCENE_PROMPTS };
