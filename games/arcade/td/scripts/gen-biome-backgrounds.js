/**
 * Generate per-biome ground textures + sky panoramas for Towers (TD) scenery.
 *   node scripts/gen-biome-backgrounds.js
 * Writes biome-prefixed files to public/assets/img/scene/ (does NOT touch the
 * existing ground-terrain.png / sky-env.png) and logs to that dir's .genlog.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'scene');
const LOG = path.join(OUT, '.genlog-biomes');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, people, buildings, characters, blurry, lowres';

const GROUND = 'seamless, tileable, no seams, flat overhead view, game ground texture';
const SKY = 'panorama, atmospheric background';

const JOBS = [
  { file: 'desert-ground.png', size: '512x512', steps: 24, prompt: `seamless tileable top-down sandy desert dunes with cracked rock, ${GROUND}, no text` },
  { file: 'desert-sky.png', size: '512x512', steps: 26, prompt: `arid dusk sky, hazy orange horizon, ${SKY}, no text` },
  { file: 'forest-ground.png', size: '512x512', steps: 24, prompt: `seamless tileable top-down mossy forest floor, ${GROUND}, no text` },
  { file: 'forest-sky.png', size: '512x512', steps: 26, prompt: `misty green forest canopy sky, ${SKY}, no text` },
  { file: 'mountain-ground.png', size: '512x512', steps: 24, prompt: `seamless tileable top-down rocky grey mountain scree, ${GROUND}, no text` },
  { file: 'mountain-sky.png', size: '512x512', steps: 26, prompt: `cold alpine sky, ${SKY}, no text` },
  { file: 'tundra-ground.png', size: '512x512', steps: 24, prompt: `seamless tileable top-down snow and frozen rock, ${GROUND}, no text` },
  { file: 'tundra-sky.png', size: '512x512', steps: 26, prompt: `pale frozen overcast sky, ${SKY}, no text` },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} biome jobs`);
  for (const j of JOBS) {
    log(`generating ${j.file}...`);
    const t0 = Date.now();
    const b64 = await generateImage(j.prompt, { size: j.size, steps: j.steps, negativePrompt: NEG, timeoutMs: 180000 });
    if (!b64) { log(`FAILED ${j.file}`); continue; }
    fs.writeFileSync(path.join(OUT, j.file), Buffer.from(b64, 'base64'));
    log(`saved ${j.file} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  log('DONE');
}
main().catch(e => { log('ERROR ' + e.message); process.exit(1); });
