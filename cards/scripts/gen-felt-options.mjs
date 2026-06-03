/**
 * Generate alternate "poker room" felt + table looks via the SD gateway.
 * Saves options into /srv/cards/public/img/assets/options/ so they can be
 * previewed and the winner copied over felt.png / rail.png.
 *   OLLAMA_KEY=... node scripts/gen-felt-options.mjs
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.SD_BASE || 'http://localhost:11400';
const KEY = process.env.OLLAMA_KEY || '';
const OUT = '/srv/cards/public/img/assets/options';
fs.mkdirSync(OUT, { recursive: true });

const NEG = 'text, letters, numbers, words, watermark, signature, logo, blurry, lowres, jpeg artifacts, people, hands, cards, seams, border, vignette edges';

const ASSETS = [
  { file: 'felt-emerald.png', size: '512x512', steps: 26,
    prompt: 'seamless tileable luxury casino poker table felt texture, deep emerald green wool baize, fine even fabric weave, soft diffuse studio light, flat top-down, premium, no border' },
  { file: 'felt-sapphire.png', size: '512x512', steps: 26,
    prompt: 'seamless tileable casino poker table felt texture, rich royal sapphire blue speed cloth, smooth suited surface, soft even lighting, flat top-down, premium, no border' },
  { file: 'felt-crimson.png', size: '512x512', steps: 26,
    prompt: 'seamless tileable casino poker table felt texture, deep crimson burgundy wool baize, fine fabric weave, soft even lighting, flat top-down, premium high roller, no border' },
  { file: 'felt-charcoal.png', size: '512x512', steps: 26,
    prompt: 'seamless tileable casino poker table felt texture, dark charcoal graphite speed cloth with subtle teal sheen, modern premium card room, soft even lighting, flat top-down, no border' },
];

async function gen(a) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ prompt: a.prompt, negative_prompt: NEG, n: 1, size: a.size, steps: a.steps }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) { console.error(`${a.file}: HTTP ${res.status}`); return false; }
  const d = await res.json();
  const b64 = d?.data?.[0]?.b64_json;
  if (!b64) { console.error(`${a.file}: no image`); return false; }
  fs.writeFileSync(path.join(OUT, a.file), Buffer.from(b64, 'base64'));
  console.log(`${a.file}: ${(Buffer.from(b64,'base64').length/1024|0)}KB in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return true;
}

let ok = 0;
for (const a of ASSETS) { if (await gen(a)) ok++; }
console.log(`\ndone: ${ok}/${ASSETS.length} -> ${OUT}`);
process.exit(ok ? 0 : 1);
