/**
 * stats — export finished-game results to the platform master leaderboard +
 * per-user stats (WEBGAMES_PROTOCOL §5). Machine-to-machine, best-effort: a
 * failure is logged and ignored, never blocking the table.
 *
 *   POST {platform}/internal/webgame/score   (x-bridge-secret)
 *   one call per *human* seat (bots and dev/guest seats are skipped)
 *
 * Handles both scoring models:
 *   - partnership (euchre): 2-team, higher team score wins.
 *   - individual (hearts): per-seat totals, lowest wins. Detected when the
 *     variant exposes gameResult()/standings() (table.finalTotals is set).
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
  const individual = Array.isArray(table.finalTotals); // hearts-style scoring

  let posted = 0;
  await Promise.all(humans.map(async (s) => {
    let payload;
    if (individual) {
      const totals = table.finalTotals;
      const myScore = totals[s.seat];
      const won = s.seat === table.winnerSeat;
      const opponents = [0, 1, 2, 3].filter((x) => x !== s.seat);
      payload = {
        game: table.game,
        platformId: s.platformId,
        displayName: s.displayName,
        event: 'game-end',
        score: myScore,                       // hearts: lower is better
        status: won ? 'won' : 'lost',
        durationMs,
        meta: {
          result: won ? 'win' : 'loss',
          scoring: 'individual',
          myScore,
          lowestScore: Math.min(...totals),
          rank: totals.filter((t) => t < myScore).length + 1, // 1 = best
          seat: s.seat,
          opponents: opponents.map((x) => names[x]),
        },
      };
    } else {
      const team = s.seat % 2;
      const won = team === table.winnerTeam;
      const partnerSeat = (s.seat + 2) % 4;
      payload = {
        game: table.game,
        platformId: s.platformId,
        displayName: s.displayName,
        event: 'game-end',
        score: table.scores[team],
        status: won ? 'won' : 'lost',
        durationMs,
        meta: {
          result: won ? 'win' : 'loss',
          scoring: 'team',
          teamScore: table.scores[team],
          opponentScore: table.scores[1 - team],
          hands: table.tally.hands,
          euchres: table.tally.euchres,
          marches: table.tally.marches,
          lones: table.tally.lones,
          seat: s.seat,
          partner: names[partnerSeat],
          opponents: [names[(s.seat + 1) % 4], names[(s.seat + 3) % 4]],
        },
      };
    }
    try {
      if (await post(url, payload)) posted += 1;
      else console.warn('[cards stats] ingest non-2xx for', s.platformId);
    } catch (e) {
      console.warn('[cards stats] ingest failed for', s.platformId, e.message);
    }
  }));
  return { posted, of: humans.length };
}

export default { reportGameResult };
