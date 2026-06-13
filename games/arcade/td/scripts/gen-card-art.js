/**
 * Cron one-shot: backfill SD backgrounds for a few action cards, then exit.
 * Scheduled every 5 min via /etc/cron.d/td-card-art. Also safe to run by hand:
 *   node scripts/gen-card-art.js
 *   CARD_ART_LIMIT=4 node scripts/gen-card-art.js
 */
import { connectDb } from '../services/db.js';
import { backfillCardBackgrounds } from '../services/art/card-backgrounds.js';

const LIMIT = parseInt(process.env.CARD_ART_LIMIT || '2', 10);

(async () => {
  const t0 = Date.now();
  try {
    await connectDb();
    const r = await backfillCardBackgrounds({ limit: LIMIT });
    console.log(`[${new Date().toISOString()}] card-art ${JSON.stringify(r)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exit(0);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] card-art ERROR ${e.message}`);
    process.exit(1);
  }
})();
