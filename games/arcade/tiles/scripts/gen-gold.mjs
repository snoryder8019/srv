/**
 * One-off: generate a seamless GOLD texture via the madLadsLab SD gateway and
 * save it to public/img/gold.png for the shared casino chip-burst skin.
 * Run from /srv/games/arcade/tiles:  node scripts/gen-gold.mjs
 * Falls back to nothing (caller uses a procedural gold gradient) if SD returns null.
 */
import { generateImage } from '../services/ai/client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'img');
fs.mkdirSync(OUT, { recursive: true });

const PROMPT = 'seamless tileable polished gold metal texture, luxury brushed gold foil, '
  + 'warm metallic sheen, fine grain, even soft studio lighting, top-down flat, '
  + 'high detail, photographic, casino luxe';
const NEG = 'text, letters, numbers, watermark, logo, seams, border, frame, people, '
  + 'hands, blurry, lowres, dark, shadow blobs, cartoon';

const t0 = Date.now();
console.log('[gold] requesting SD…');
const b64 = await generateImage(PROMPT, { size: '512x512', steps: 26, negativePrompt: NEG, timeoutMs: 180000 });
if (!b64) { console.log('[gold] FAILED (gateway null) after', ((Date.now()-t0)/1000)|0, 's'); process.exit(2); }
const buf = Buffer.from(b64, 'base64');
const dest = path.join(OUT, 'gold.png');
fs.writeFileSync(dest, buf);
console.log('[gold] saved', dest, buf.length, 'bytes in', ((Date.now()-t0)/1000)|0, 's');
process.exit(0);
