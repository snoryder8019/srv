/**
 * Generate enemy codex portrait art for Towers (TD) via SD gateway.
 *   node scripts/gen-enemy-art.js
 * Writes to public/assets/img/enemies/ and logs to that dir's .genlog.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'enemies');
const LOG = path.join(OUT, '.genlog');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, blurry, lowres';

const STYLE = 'dark fantasy military sci-fi codex portrait bust, menacing, 3/4 view, dark background, cyan glowing accents, indigo nebula tones, highly detailed concept art, no text';

const JOBS = [
  { file: 'basic.png', size: '512x512', steps: 24, prompt: `rusty scrap walker robot, ${STYLE}` },
  { file: 'grunt.png', size: '512x512', steps: 24, prompt: `battered foot-soldier bot, ${STYLE}` },
  { file: 'fast.png', size: '512x512', steps: 24, prompt: `sleek razor runner droid, ${STYLE}` },
  { file: 'runner.png', size: '512x512', steps: 24, prompt: `light sprint drone, ${STYLE}` },
  { file: 'tank.png', size: '512x512', steps: 24, prompt: `massive siege hull tracked robot, ${STYLE}` },
  { file: 'machine.png', size: '512x512', steps: 24, prompt: `towering war machine, ${STYLE}` },
  { file: 'infiltrator.png', size: '512x512', steps: 24, prompt: `stealthy phantom infiltrator unit, shadowy, ${STYLE}` },
  { file: 'flyer.png', size: '512x512', steps: 24, prompt: `cybernetic hawk talon drone, ${STYLE}` },
  { file: 'flyer2.png', size: '512x512', steps: 24, prompt: `storm parrot mech-bird, ${STYLE}` },
  { file: 'swarmer.png', size: '512x512', steps: 24, prompt: `tiny insectile swarm mite, ${STYLE}` },
  { file: 'brute.png', size: '512x512', steps: 24, prompt: `huge iron brute juggernaut, ${STYLE}` },
  { file: 'gunship.png', size: '512x512', steps: 24, prompt: `armored vulture gunship drone, menacing, ${STYLE}` },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} enemy jobs`);
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
