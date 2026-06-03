/**
 * Generate per-KIND scene art via the SD tunnel: a sky/backdrop + a hex-tile
 * terrain texture for each siege kind. Saves to public/assets/img/scene/ as
 * <kind>-sky.png and <kind>-tile.png. Re-runnable; gateway down -> skips (the
 * client falls back to flat colors). Run from /srv/madlands:
 *   node scripts/gen-scene-assets.mjs [space|dungeon|building|ground|all]
 */
import { generateImage, aiHealth } from '../services/ai/client.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('public/assets/img/scene');

// viking · space · funk · metal · pop house style threads through every prompt.
const SKY = {
  space:    'deep space nebula vista, stars and distant ringed planets, viking-metal sci-fi, vast and dark, cinematic',
  dungeon:  'vast underground cavern, glowing crystals and bioluminescence, wet rock walls, torch glow, dark fantasy, atmospheric',
  building: 'interior of a futuristic station corridor, brushed metal panels, neon accent strips, moody volumetric light',
  ground:   'alien planet surface at dusk, dramatic banded sky, distant jagged mountains, funk-metal sci-fi landscape',
};
const TILE = {
  space:    'top-down seamless sci-fi deck plating texture, dark steel panels with faint neon seams, tileable, even lighting',
  dungeon:  'top-down seamless cracked cavern stone floor texture, dark rock with moss and mineral veins, tileable, even lighting',
  building: 'top-down seamless industrial metal floor plating texture, hex panels and rivets, tileable, even lighting',
  ground:   'top-down seamless alien terrain texture, sand stone and dry cracked earth, warm tones, tileable, even lighting',
};
const NEG = 'text, watermark, people, characters, ui, logo, frame, border';

async function gen(kind, kindType, prompt, size) {
  const b64 = await generateImage(prompt, { size, steps: 20, negativePrompt: NEG, timeoutMs: 120000 });
  if (!b64) { console.log(`MISS ${kind}-${kindType}`); return false; }
  await fs.mkdir(OUT, { recursive: true });
  const file = path.join(OUT, `${kind}-${kindType}.png`);
  await fs.writeFile(file, Buffer.from(b64, 'base64'));
  console.log(`OK   ${kind}-${kindType}.png (${Math.round(b64.length * 0.75 / 1024)} KB)`);
  return true;
}

const which = (process.argv[2] || 'all').toLowerCase();
const kinds = which === 'all' ? Object.keys(SKY) : [which];
const h = await aiHealth();
console.log('ai health:', JSON.stringify(h));
for (const k of kinds) {
  try { await gen(k, 'sky', SKY[k], '512x512'); } catch (e) { console.log(`ERR ${k}-sky: ${e.message}`); }
  try { await gen(k, 'tile', TILE[k], '512x512'); } catch (e) { console.log(`ERR ${k}-tile: ${e.message}`); }
}
