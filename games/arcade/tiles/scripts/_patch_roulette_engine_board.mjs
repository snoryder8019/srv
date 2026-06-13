/**
 * Extend the roulette engine with dozens + columns (2:1) so the full board has
 * real bets behind it. Updates OUTSIDES, betWins(), the payout multiplier, and
 * the bet-side validation. Straight number stays 35:1; even-money outsides 1:1.
 * Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/arcade/tiles/roulette/index.js';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes("'dozen1'")) { console.log('already extended'); process.exit(0); }

// 1) OUTSIDES list — add dozens + columns (these all pay, and are surfaced as legal)
s = s.replace(
  "const OUTSIDES = ['red', 'black', 'even', 'odd', 'low', 'high'];",
  "const OUTSIDES = ['red', 'black', 'even', 'odd', 'low', 'high'];\n// 2:1 bets (dozens + columns). Kept separate so payout math can apply the 2x.\nconst TWO_TO_ONE = ['dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'];\nconst ALL_SIDES = OUTSIDES.concat(TWO_TO_ONE);"
);

// 2) betWins — add dozen/column logic
s = s.replace(
  "    case 'high': return n >= 19 && n <= 36;\n    case 'number': return n === betN;\n    default: return false;",
  "    case 'high': return n >= 19 && n <= 36;\n    case 'dozen1': return n >= 1 && n <= 12;\n    case 'dozen2': return n >= 13 && n <= 24;\n    case 'dozen3': return n >= 25 && n <= 36;\n    case 'col1': return n % 3 === 1;\n    case 'col2': return n % 3 === 2;\n    case 'col3': return n % 3 === 0;\n    case 'number': return n === betN;\n    default: return false;"
);

// 3) payout multiplier — number 35:1, dozen/col 2:1, even-money 1:1
s = s.replace(
  "        const mult = bet.side === 'number' ? 35 : 1;",
  "        const mult = bet.side === 'number' ? 35 : (TWO_TO_ONE.includes(bet.side) ? 2 : 1);"
);

// 4) validation — accept the 2:1 sides too
s = s.replace(
  "    } else if (!OUTSIDES.includes(side)) {\n      return { ok: false, error: 'bad bet side' };\n    }",
  "    } else if (!ALL_SIDES.includes(side)) {\n      return { ok: false, error: 'bad bet side' };\n    }"
);

fs.writeFileSync(FILE, s);
console.log('roulette engine: dozens + columns added');
