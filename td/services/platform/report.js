/**
 * Platform score reporter - sends run results to the games.madladslab.com
 * master leaderboard over the internal channel (x-bridge-secret).
 * Best-effort and fire-and-forget: a failure here must NEVER affect gameplay.
 * See games WEBGAMES_PROTOCOL.md §5.
 */
import config from '../../config/index.js';

export async function reportScore({ platformId, displayName, score = 0, wave = 0, status = 'abandoned', durationMs = 0, meta = {} }) {
  const { url, slug, bridgeSecret } = config.platform;
  // Only report for platform-linked players, and only if we hold the secret.
  if (!bridgeSecret || !platformId) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url + '/internal/webgame/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': bridgeSecret },
      body: JSON.stringify({ game: slug, event: 'run-end', platformId: String(platformId), displayName, score, wave, status, durationMs, meta }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) console.warn('[platform-report] non-2xx:', res.status);
  } catch (e) {
    console.warn('[platform-report] failed:', e.message);
  }
}

export default { reportScore };
