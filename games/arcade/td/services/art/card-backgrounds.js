/**
 * SD-generated backgrounds for action cards.
 * Backfills any ActionCard lacking a background image, a few per run, so a
 * 5-minute cron gradually populates the whole set without hammering the GPU.
 * Each image -> public/assets/img/cards/<slug>.png, referenced by card.bgUrl.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ActionCard from '../../api/v1/models/ActionCard.js';
import { generateImage } from '../ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', 'public', 'assets', 'img', 'cards');
const LOCK = path.join(OUT, '.lock');
const PUBLIC_BASE = '/assets/img/cards';

const NEG = 'text, words, letters, watermark, signature, logo, ui, frame, border, blurry, lowres, jpeg artifacts, people, face, hands';
const RARITY_TINT = { common: 'cool steel blue', rare: 'bright cyan', epic: 'magenta and violet', legendary: 'radiant gold' };
const STAT_THEME = {
  damage: 'fiery kinetic explosive energy',
  range: 'precision optics, targeting reticles, long sightlines',
  fireRate: 'crackling electric speed streaks',
  splash: 'concussive shockwave burst',
};

function promptFor(card) {
  const tint = RARITY_TINT[card.rarity] || 'cool steel blue';
  const theme = card.effect?.kind === 'base-heal'
    ? 'restorative green healing energy, protective shield aura'
    : (STAT_THEME[card.effect?.stat] || 'arcane sci-fi tech energy');
  return `abstract ${theme} background, ${tint} glow, dark moody sci-fi fantasy trading card art, vertical composition, soft vignette, no text, no words`;
}

/** True if the card still needs a background (no url, or the file is gone). */
function needsBg(card) {
  if (!card.bgUrl) return true;
  return !fs.existsSync(path.join(OUT, card.slug + '.png'));
}

export async function backfillCardBackgrounds({ limit = 2 } = {}) {
  fs.mkdirSync(OUT, { recursive: true });

  // Lock so overlapping cron ticks don't double-generate (stale after 4 min).
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < 4 * 60 * 1000) return { skipped: 'locked' };
  } catch { /* no lock */ }
  fs.writeFileSync(LOCK, String(Date.now()));

  const result = { generated: 0, failed: 0, remaining: 0, cards: [] };
  try {
    const all = await ActionCard.find().sort({ slug: 1 });
    const need = all.filter(needsBg);
    const batch = need.slice(0, limit);
    for (const card of batch) {
      const b64 = await generateImage(promptFor(card), { size: '512x512', steps: 22, negativePrompt: NEG, timeoutMs: 180000 });
      if (!b64) { result.failed++; continue; }
      fs.writeFileSync(path.join(OUT, card.slug + '.png'), Buffer.from(b64, 'base64'));
      card.bgUrl = `${PUBLIC_BASE}/${card.slug}.png`;
      await card.save();
      result.generated++;
      result.cards.push(card.slug);
    }
    result.remaining = need.length - result.generated;
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
  }
  return result;
}

export default { backfillCardBackgrounds };
