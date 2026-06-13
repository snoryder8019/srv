/**
 * One-off: generate the cards visual asset set via the SD gateway
 * (ollama.madladslab.com, OpenAI-style /v1/images/generations, SD v1.5).
 * Saves PNGs into /srv/games/arcade/cards/public/img/assets/. Run offline, never in a request path.
 *
 *   OLLAMA_KEY=... node scripts/gen-assets.mjs
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.SD_BASE || 'http://localhost:11400';
const KEY = process.env.OLLAMA_KEY || '';
const OUT = '/srv/games/arcade/cards/public/img/assets';
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, letters, numbers, watermark, signature, blurry, lowres, jpeg artifacts, people, hands, realistic photo';

const ASSETS = [
  { file: 'card-back.png', size: '512x512', steps: 26,
    prompt: 'ornate playing card back design, perfectly symmetric damask filigree pattern, deep crimson red and antique gold, centered round medallion, intricate ornamental border frame, vintage luxury casino card back, flat top-down, clean vector illustration' },
  { file: 'felt.png', size: '512x512', steps: 22,
    prompt: 'seamless dark green casino poker table felt texture, fine wool fabric weave, soft even studio lighting, top-down flat, subtle fibers, rich emerald green' },
  { file: 'rail.png', size: '512x512', steps: 22,
    prompt: 'seamless polished dark mahogany wood and black padded leather poker table rail border texture, luxurious, top-down, soft highlights' },
  { file: 'crest.png', size: '512x512', steps: 26,
    prompt: 'circular ornate heraldic emblem featuring the four playing card suits hearts diamonds clubs spades, antique gold filigree on deep green, perfectly symmetric, vintage casino crest logo, centered, dark background' },
];

async function gen(a) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ prompt: a.prompt, negative_prompt: NEG, n: 1, size: a.size, steps: a.steps }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) { console.error(`${a.file}: HTTP ${res.status} ${(await res.text()).slice(0,120)}`); return false; }
  const d = await res.json();
  const b64 = d?.data?.[0]?.b64_json;
  if (!b64) { console.error(`${a.file}: no image (${JSON.stringify(d).slice(0,120)})`); return false; }
  fs.writeFileSync(path.join(OUT, a.file), Buffer.from(b64, 'base64'));
  console.log(`${a.file}: ${(Buffer.from(b64,'base64').length/1024|0)}KB in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return true;
}

let ok = 0;
for (const a of ASSETS) { if (await gen(a)) ok++; }
console.log(`\ndone: ${ok}/${ASSETS.length} assets -> ${OUT}`);
process.exit(ok === ASSETS.length ? 0 : 1);
