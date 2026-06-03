/**
 * Generate NPC "headset" bust portraits for story arcs via the SD gateway.
 *   node scripts/gen-story-portraits.js
 * Writes to public/assets/img/story/ and logs to that dir's .genlog-portraits.
 * Filenames match Story.characters[].slug so seed-campaign portraits can point here.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img', 'story');
const LOG = path.join(OUT, '.genlog-portraits');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, blurry, lowres, deformed, extra limbs, multiple heads, frame, border';
const STYLE = 'sci-fi character portrait, headset bust shot, head and shoulders, dramatic rim lighting, dark background, detailed, painterly concept art';

const JOBS = [
  { file: 'vesk.png',          prompt: `grizzled veteran field commander, cybernetic eye, military headset, scar, cyan glowing HUD reflection, stern, ${STYLE}` },
  { file: 'scout-7.png',       prompt: `sleek recon drone unit with a single green optical sensor, antenna, matte armor, hovering, ${STYLE}` },
  { file: 'warden.png',        prompt: `defense AI core avatar, holographic geometric face, calm blue light, glowing circuits, ${STYLE}` },
  { file: 'quartermaster.png', prompt: `gruff supply quartermaster soldier, utility vest, cigar, amber lighting, crates behind, ${STYLE}` },
  { file: 'korrath.png',       prompt: `menacing enemy warlord war-machine, brutal red-eyed steel skull face, spikes, ominous, ${STYLE}` },
  { file: 'medic.png',         prompt: `combat field medic, visor, teal medical cross emblem, focused expression, ${STYLE}` },
];

function log(m) { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); }

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} portrait jobs`);
  for (const j of JOBS) {
    log(`generating ${j.file}...`);
    const t0 = Date.now();
    const b64 = await generateImage(j.prompt, { size: '512x512', steps: 28, negativePrompt: NEG, timeoutMs: 180000 });
    if (!b64) { log(`FAILED ${j.file}`); continue; }
    fs.writeFileSync(path.join(OUT, j.file), Buffer.from(b64, 'base64'));
    log(`saved ${j.file} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  log('DONE');
}
main().catch(e => { log('ERROR ' + e.message); process.exit(1); });
