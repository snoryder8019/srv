/**
 * Generate tower emplacement art for Towers (TD) via SD gateway.
 *   node scripts/gen-tower-art.js
 * Writes to public/assets/img/towers/ and logs to that dir's .genlog.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'towers');
const LOG = path.join(OUT, '.genlog');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, blurry, lowres';

const STYLE = 'dark fantasy military sci-fi emplacement, isometric 3/4 view, clean dark background, cyan glowing accents, indigo nebula tones, highly detailed concept art, no text';

const JOBS = [
  { file: 'gatling-bunker.png', size: '512x512', steps: 24, prompt: `squat armored rapid-fire gatling turret bunker, ${STYLE}` },
  { file: 'flak-battery.png', size: '512x512', steps: 24, prompt: `anti-air flak autocannon battery with raised barrels, ${STYLE}` },
  { file: 'bastion-cannon.png', size: '512x512', steps: 24, prompt: `heavy siege bastion cannon emplacement, ${STYLE}` },
  { file: 'plasma-mortar.png', size: '512x512', steps: 24, prompt: `energy plasma mortar lobbing glowing plasma, ${STYLE}` },
  { file: 'arc-coil-tower.png', size: '512x512', steps: 24, prompt: `tesla arc coil tower crackling with arcs of lightning, ${STYLE}` },
  { file: 'tesla-fence.png', size: '512x512', steps: 24, prompt: `low electric tesla pylon array fence, ${STYLE}` },
  { file: 'spire-railgun.png', size: '512x512', steps: 24, prompt: `tall sleek railgun sniper spire tower, ${STYLE}` },
  { file: 'aegis-pylon.png', size: '512x512', steps: 24, prompt: `glowing support aegis pylon emitting a shield aura, ${STYLE}` },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} tower jobs`);
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
