/**
 * Generate the seize/defend/explore area icons via the SD tunnel and save them
 * as PNG sprites under public/assets/img/icons/. Re-runnable; safe to skip if
 * the gateway is down (the client has a procedural fallback). Run from /srv/madlands:
 *   node scripts/gen-siege-icons.mjs [siege|defend|explore|all]
 */
import { generateImage, aiHealth } from '../services/ai/client.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('public/assets/img/icons');
const STYLE = 'centered emblem game map icon, on solid black background, glowing neon edges, ' +
  'flat vector insignia, high contrast, simple silhouette, no text, no border';

const PROMPTS = {
  siege:   `crossed swords and a breaching ram, ${STYLE}, fiery amber and orange glow`,
  defend:  `heater shield with a central rune, ${STYLE}, electric blue glow`,
  explore: `compass rose over a footprint trail, ${STYLE}, soft teal-green glow`,
};

async function one(name) {
  const b64 = await generateImage(PROMPTS[name], { size: '256x256', steps: 22, timeoutMs: 120000 });
  if (!b64) { console.log(`MISS ${name} (gateway returned null)`); return false; }
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'));
  console.log(`OK   ${name}.png (${Math.round(b64.length * 0.75 / 1024)} KB)`);
  return true;
}

const which = (process.argv[2] || 'all').toLowerCase();
const h = await aiHealth();
console.log('ai health:', JSON.stringify(h));
const names = which === 'all' ? Object.keys(PROMPTS) : [which];
for (const n of names) { try { await one(n); } catch (e) { console.log(`ERR ${n}: ${e.message}`); } }
