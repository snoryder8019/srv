/**
 * stats — export finished tile-game results to the platform master leaderboard +
 * per-user stats. Machine-to-machine, best-effort: a failure is logged and
 * ignored, never blocking the table. Mirrors the cards stats contract.
 *
 *   POST {platform}/internal/webgame/score   (x-bridge-secret)
 *   one call per *human* seat (bots and dev/guest seats are skipped)
 *
 * Tiles are individually scored: per-seat totals in table.finalTotals, with the
 * winner at table.winnerSeat. A variant decides whether high or low is better and
 * sets winnerSeat accordingly via its gameResult() seam; this exporter just
 * reports each human's own score, rank, and win/loss.
 */
import config from '../config/index.js';

const isHuman = (s) =>
  s && s.platformId && !s.bot &&
  !String(s.platformId).startsWith('bot:') &&
  !String(s.platformId).startsWith('dev:') &&
  !String(s.platformId).startsWith('guest:');

async function post(url, payload) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-secret': config.platform.bridgeSecret },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000),
  });
  return r.ok;
}

export async function reportGameResult(table) {
  const durationMs = (table.endedAt || Date.now()) - (table.startedAt || Date.now());
  const names = table.seats.map((s) => s.displayName);
  const humans = table.seats.filter(isHuman);
  if (!humans.length || !config.platform.bridgeSecret) return { posted: 0 };
  const url = `${config.platform.url}/internal/webgame/score`;
  const totals = Array.isArray(table.finalTotals) ? table.finalTotals : table.scores;
  // rank: how many players strictly beat me. "Better" direction is encoded by the
  // variant already choosing winnerSeat; we infer best = the winner's score.
  const winnerScore = totals[table.winnerSeat];
  const lowerIsBetter = winnerScore === Math.min(...totals);

  let posted = 0;
  await Promise.all(humans.map(async (s) => {
    const myScore = totals[s.seat];
    const won = s.seat === table.winnerSeat;
    const betterCount = totals.filter((t) => (lowerIsBetter ? t < myScore : t > myScore)).length;
    const opponents = table.seats.filter((x) => x.seat !== s.seat).map((x) => names[x.seat]);
    const payload = {
      game: table.game,
      platformId: s.platformId,
      displayName: s.displayName,
      event: 'game-end',
      score: myScore,
      status: won ? 'won' : 'lost',
      durationMs,
      meta: {
        result: won ? 'win' : 'loss',
        scoring: 'individual',
        myScore,
        winnerScore,
        lowerIsBetter,
        rank: betterCount + 1, // 1 = best
        seat: s.seat,
        opponents,
        hands: (table.tally && table.tally.hands) || 0,
      },
    };
    try {
      if (await post(url, payload)) posted += 1;
      else console.warn('[tiles stats] ingest non-2xx for', s.platformId);
    } catch (e) {
      console.warn('[tiles stats] ingest failed for', s.platformId, e.message);
    }
  }));
  return { posted, of: humans.length };
}

export default { reportGameResult };
