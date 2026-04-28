/**
 * Game logic for 501 and Cricket.
 * Supports 1–N players. Solo play uses the same code path with no opponents.
 */

// ── 501 ──
function apply501Round(playerState, darts) {
  const total = darts.reduce((s, d) => s + d.score, 0);
  const remaining = playerState.remaining - total;

  // Bust: went below 0, or hit exactly 1, or hit 0 without a double
  if (remaining < 0 || remaining === 1) {
    return { busted: true, remaining: playerState.remaining, total: 0 };
  }
  if (remaining === 0) {
    const lastDart = darts[darts.length - 1];
    if (lastDart.ring !== 'double' && lastDart.ring !== 'inner_bull') {
      return { busted: true, remaining: playerState.remaining, total: 0 };
    }
    return { busted: false, remaining: 0, total, won: true };
  }
  return { busted: false, remaining, total };
}

// ── Cricket ──
const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 'bull'];

function dartMarks(dart) {
  if (dart.ring === 'miss') return { target: null, marks: 0 };
  let target = dart.segment;
  if (dart.ring === 'inner_bull' || dart.ring === 'outer_bull') target = 'bull';
  if (!CRICKET_NUMBERS.includes(target)) return { target: null, marks: 0 };
  let marks = 1;
  if (dart.ring === 'double') marks = 2;
  if (dart.ring === 'triple') marks = 3;
  if (dart.ring === 'inner_bull') marks = 2;
  return { target, marks };
}

/**
 * Multi-player cricket round.
 * `opponents` is an array of opponent player states (can be empty for solo).
 *
 * Overflow (scoring) rule: once this player has 3+ marks on a number,
 * additional hits score points — provided at least one opponent has NOT
 * yet closed that number (< 3 marks). In solo play (no opponents), every
 * overflow hit scores, so the player always has a target to chase.
 */
function applyCricketRound(playerState, darts, opponents) {
  // Backwards-compat: accept single-opponent object for 2-player calls
  if (opponents && !Array.isArray(opponents)) opponents = [opponents];
  opponents = opponents || [];

  let pointsScored = 0;
  const updatedMarks = { ...playerState.marks };

  for (const dart of darts) {
    const { target, marks } = dartMarks(dart);
    if (!target) continue;

    const key = String(target);
    const currentMarks = updatedMarks[key] || 0;

    // Number is "open for scoring" if any opponent has not yet closed it,
    // OR if there are no opponents at all (solo).
    const someoneOpen = opponents.length === 0
      || opponents.some(op => (op.marks?.[key] || 0) < 3);

    const marksToClose = Math.max(0, 3 - currentMarks);
    const closing  = Math.min(marks, marksToClose);
    const overflow = marks - closing;

    updatedMarks[key] = currentMarks + closing;

    if (overflow > 0 && someoneOpen) {
      const pointValue = target === 'bull' ? 25 : target;
      pointsScored += overflow * pointValue;
    }
  }

  return {
    marks: updatedMarks,
    pointsScored,
    cricketPoints: playerState.cricketPoints + pointsScored
  };
}

/**
 * Multi-player cricket winner check.
 * `opponents` is an array (empty array for solo).
 * Solo: player "wins" by closing all numbers (no point comparison).
 * Multi: must have closed all numbers AND have points >= every opponent.
 */
function isCricketWinner(playerState, opponents) {
  if (opponents && !Array.isArray(opponents)) opponents = [opponents];
  opponents = opponents || [];

  const allClosed = CRICKET_NUMBERS.every(n => (playerState.marks[String(n)] || 0) >= 3);
  if (!allClosed) return false;
  if (opponents.length === 0) return true;
  const maxOppPoints = Math.max(...opponents.map(o => o.cricketPoints || 0));
  return playerState.cricketPoints >= maxOppPoints;
}

module.exports = { apply501Round, applyCricketRound, isCricketWinner, CRICKET_NUMBERS };
