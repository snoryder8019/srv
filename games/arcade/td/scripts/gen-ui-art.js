/**
 * Generate UI / branding art: faction emblems, splash background, rank medals,
 * and HUD accents via the SD gateway.
 *   node scripts/gen-ui-art.js
 * Writes to public/assets/img/ui/ and logs to that dir's .genlog.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'ui');
const LOG = path.join(OUT, '.genlog');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, typography, blurry, lowres, photo, realistic face';
const ICON = 'game emblem, centered, clean vector-like insignia, dark background, glowing accents, symmetrical, crisp';

const JOBS = [
  { file: 'emblem-defenders.png', size: '512x512', steps: 28, prompt: `military defender faction crest, a fortified hex tower over crossed cannons inside a heraldic shield, cyan and steel, ${ICON}` },
  { file: 'emblem-attackers.png', size: '512x512', steps: 28, prompt: `menacing machine-army faction insignia, a red-eyed mechanical skull with gear horns, ominous crimson, ${ICON}` },
  { file: 'logo-mark.png',        size: '512x512', steps: 28, prompt: `abstract tower-defense logo mark, a glowing hexagonal turret silhouette emblem, minimal, cyan glow, ${ICON}` },
  { file: 'splash-bg.png',        size: '768x512', steps: 26, prompt: `main menu splash background, a towering hex fortress on an alien battlefield at dusk, cinematic, dark fantasy tech, atmospheric, no text` },
  { file: 'medal-bronze.png',     size: '512x512', steps: 24, prompt: `bronze military rank medal with ribbon, hexagon center, ${ICON}` },
  { file: 'medal-silver.png',     size: '512x512', steps: 24, prompt: `silver military rank medal with ribbon, hexagon center, ${ICON}` },
  { file: 'medal-gold.png',       size: '512x512', steps: 24, prompt: `gold military rank medal with ribbon, glowing hexagon center, ${ICON}` },
  { file: 'hud-frame.png',        size: '512x512', steps: 22, prompt: `sci-fi HUD corner frame accents on transparent dark background, glowing cyan brackets and tick marks, clean interface decoration, no text` },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} ui jobs`);
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
