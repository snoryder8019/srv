/**
 * Platform score reporter — sends a finished run to games.madladslab.com's
 * master leaderboard over the internal channel (x-bridge-secret). Best-effort
 * and fire-and-forget; a failure here must never affect play. WEBGAMES §5.
 */
import config from '../../config/index.js';

export async function reportScore({ platformId, displayName, score = 0, status = 'abandoned', durationMs = 0, meta = {} }) {
  const { url, slug, bridgeSecret } = config.platform;
  if (!bridgeSecret || !platformId) return { ok: false, skipped: true };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url + '/internal/webgame/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': bridgeSecret },
      body: JSON.stringify({ game: slug, event: 'run-end', platformId: String(platformId), displayName, score, wave: 0, status, durationMs, meta }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, ...(await res.json().catch(() => ({}))) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export default { reportScore };
