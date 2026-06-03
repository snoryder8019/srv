import 'dotenv/config';
import { generateImage, PROPOSAL_DESIGN_PROMPTS, listMissing, SD_OUT_DIR } from '../lib/sd.js';

const force = process.argv.includes('--force');
const designs = force ? Object.keys(PROPOSAL_DESIGN_PROMPTS) : listMissing();

console.log(`[seed-sd] output: ${SD_OUT_DIR}`);
if (!designs.length) {
  console.log('[seed-sd] all 5 design images already cached. Use --force to regenerate.');
  process.exit(0);
}

console.log(`[seed-sd] generating ${designs.length}: ${designs.join(', ')}`);

for (const id of designs) {
  const t = Date.now();
  try {
    const fp = await generateImage(id, { force });
    console.log(`[seed-sd] ${id} ✓  ${((Date.now() - t) / 1000).toFixed(1)}s  ${fp}`);
  } catch (err) {
    console.error(`[seed-sd] ${id} ✗ ${err.message}`);
  }
}
console.log('[seed-sd] done');
