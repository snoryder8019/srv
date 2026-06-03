/**
 * Generate 3D scene art (ground + sky) for the Towers board via SD gateway.
 *   node scripts/gen-scene-art.js
 * Writes to public/assets/img/scene/ and logs to that dir's .genlog.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'scene');
const LOG = path.join(OUT, '.genlog');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, people, buildings, characters, blurry, lowres';

const JOBS = [
  {
    file: 'ground-terrain.png', size: '512x512', steps: 24,
    prompt: 'seamless tileable top-down dark fantasy terrain texture, cracked volcanic rock with mossy cyan glowing veins, fine detail, flat overhead view, game ground texture, no seams, no text',
  },
  {
    file: 'sky-env.png', size: '512x512', steps: 26,
    prompt: 'dark fantasy night sky panorama, deep indigo and violet nebula, faint cyan stars, distant floating islands silhouette, soft gradient horizon, atmospheric background, no text',
  },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} scene jobs`);
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
