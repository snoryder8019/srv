/**
 * Generate cinematic key-art banners for the campaign levels via the SD gateway.
 *   node scripts/gen-level-banners.js
 * Writes to public/assets/img/levels/ (filenames match Level.slug) + a campaign splash.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'levels');
const LOG = path.join(OUT, '.genlog');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, ui, hud, blurry, lowres, people faces';
const STYLE = 'epic sci-fi tower-defense key art, cinematic wide shot, dramatic lighting, dark fantasy tech, glowing cyan accents, atmospheric, concept art';

const JOBS = [
  { file: 'campaign-1-first-contact.png', prompt: `lone defense outpost at dawn, first wave of rusty walker robots emerging from a misty canyon, calm before the storm, ${STYLE}` },
  { file: 'campaign-2-swarm.png',         prompt: `a massive swarm of small fast drones flooding a hex battlefield toward turrets, motion, sparks, ${STYLE}` },
  { file: 'campaign-3-heavy-metal.png',   prompt: `colossal armored tank hull war-machines grinding forward, heavy artillery towers firing, smoke, ${STYLE}` },
  { file: 'campaign-4-air-raid.png',      prompt: `sky filled with armored gunship drones and mech-birds dive-bombing a base, flak bursts, ${STYLE}` },
  { file: 'campaign-5-the-onslaught.png', prompt: `desperate final battle, base under massive siege from every direction, explosions, glowing core, last stand, ${STYLE}` },
  { file: 'campaign-prime-splash.png',    prompt: `grand campaign title splash, a fortified hex citadel glowing against a stormy alien horizon, armies massing, ${STYLE}` },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} banner jobs`);
  for (const j of JOBS) {
    log(`generating ${j.file}...`);
    const t0 = Date.now();
    const b64 = await generateImage(j.prompt, { size: '768x512', steps: 26, negativePrompt: NEG, timeoutMs: 180000 });
    if (!b64) { log(`FAILED ${j.file}`); continue; }
    fs.writeFileSync(path.join(OUT, j.file), Buffer.from(b64, 'base64'));
    log(`saved ${j.file} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  log('DONE');
}
main().catch(e => { log('ERROR ' + e.message); process.exit(1); });
