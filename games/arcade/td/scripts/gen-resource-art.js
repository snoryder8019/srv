/**
 * Generate resource / loot icon art for Towers (TD) via SD gateway.
 *   node scripts/gen-resource-art.js
 * Writes to public/assets/img/resources/ and logs to that dir's .genlog.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'resources');
const LOG = path.join(OUT, '.genlog');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, blurry, lowres';

const STYLE = 'centered single game icon, dark fantasy military sci-fi, clean dark background, cyan glowing accents, indigo nebula tones, clean game-icon style, highly detailed, no text';

const JOBS = [
  { file: 'ammo.png', size: '512x512', steps: 24, prompt: `glowing ammunition crate of shells, ${STYLE}` },
  { file: 'components.png', size: '512x512', steps: 24, prompt: `mechanical parts and circuit chips, ${STYLE}` },
  { file: 'tokens.png', size: '512x512', steps: 24, prompt: `stack of glowing currency token coins, ${STYLE}` },
  { file: 'credits.png', size: '512x512', steps: 24, prompt: `sci-fi credit chip, ${STYLE}` },
  { file: 'scrap.png', size: '512x512', steps: 24, prompt: `salvage metal scrap pile, ${STYLE}` },
  { file: 'core.png', size: '512x512', steps: 24, prompt: `glowing energy core, ${STYLE}` },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} resource jobs`);
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
