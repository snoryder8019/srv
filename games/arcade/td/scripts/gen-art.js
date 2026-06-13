/**
 * Generate UI art for Towers (TD) via the SD gateway (SD v1.5).
 * Saves PNGs into public/assets/img/. Slow (SD inference) - run detached.
 *   node scripts/gen-art.js
 *
 * Writes progress to public/assets/img/.genlog so it can be polled.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage } from '../services/ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'img');
const LOG = path.join(OUT, '.genlog');
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, watermark, signature, letters, words, logo, blurry, lowres, jpeg artifacts, people, face, hands';

const JOBS = [
  {
    file: 'panel-arcane.png', size: '512x512', steps: 24,
    prompt: 'seamless dark fantasy stone panel texture, carved arcane hexagon runes glowing faint cyan, weathered slate, top-down flat, game UI background, moody, tileable, no text',
  },
  {
    file: 'hero-bg.png', size: '512x512', steps: 26,
    prompt: 'epic hexagonal fortress on floating rock island, glowing cyan and magenta energy towers defending, dark fantasy sky, deep blue and purple, cinematic concept art, no text',
  },
  {
    file: 'border-strip.png', size: '512x512', steps: 22,
    prompt: 'seamless ornate dark metal trim border texture, etched hexagon pattern, brushed gunmetal with cyan inlay, horizontal repeating strip, game UI frame, tileable, no text',
  },
  {
    file: 'vesk-portrait.png', size: '512x512', steps: 26,
    prompt: 'portrait of a weathered female battle commander, hooded cloak, glowing cyan hex sigil on armor, dark fantasy, dramatic rim light, painterly game character art, bust shot',
  },
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

async function main() {
  fs.writeFileSync(LOG, '');
  log(`start: ${JOBS.length} jobs`);
  for (const job of JOBS) {
    log(`generating ${job.file} (${job.size}, ${job.steps} steps)...`);
    const t0 = Date.now();
    const b64 = await generateImage(job.prompt, { size: job.size, steps: job.steps, negativePrompt: NEG, timeoutMs: 180000 });
    if (!b64) { log(`FAILED ${job.file}`); continue; }
    fs.writeFileSync(path.join(OUT, job.file), Buffer.from(b64, 'base64'));
    log(`saved ${job.file} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  log('DONE');
}

main().catch(e => { log('ERROR ' + e.message); process.exit(1); });
