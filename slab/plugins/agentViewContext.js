/**
 * Slab — Agent View Context
 * ─────────────────────────────────────────────────────────────────────────────
 * The ✦ constellation modal is scoped to the view/tab it's on (agentLauncher.js).
 * This turns that scope into DATA: a concise, real snapshot of the DB behind the
 * active view, injected into the agent's context so answers are grounded in THIS
 * tenant's actual numbers/records — not generic advice or a misfired tool
 * (e.g. "break down our budget" on the ledger reads the real P&L, it doesn't
 * draft an invoice).
 *
 * Extensible per module: add a case + a small loader. Any failure returns '' so
 * the agent still answers, just without the grounding.
 */
import {
  monthKey, monthRange, monthLabel, listCategories, aggregateActuals,
  getActiveBudget, revenueForMonth, budgetMapForRevenue, buildPnl, money,
} from './ledgerHelpers.js';

export async function loadViewContext(db, tenant, module) {
  if (!db || !module) return '';
  try {
    if (module === 'bookkeeping') return await financeContext(db);
  } catch (e) {
    console.warn('[viewContext] load failed for', module, '-', e.message);
  }
  return '';
}

// Finance / ledger — current-month P&L with budget variance + top expense lines.
async function financeContext(db) {
  const key = monthKey();
  const { start, end } = monthRange(key);
  const [categories, actuals] = await Promise.all([
    listCategories(db),
    aggregateActuals(db, start, end),
  ]);
  const plan = await getActiveBudget(db);
  const budget = budgetMapForRevenue(plan, revenueForMonth(plan, key));
  const pnl = buildPnl(categories, actuals, budget);

  const L = [];
  L.push(`LIVE LEDGER / BUDGET — real figures for ${monthLabel(key)} (this tenant's own books; use these, never invent numbers):`);
  L.push(`- Income:  ${money(pnl.totals.income.actual)} actual vs ${money(pnl.totals.income.budget)} budget`);
  L.push(`- COGS:    ${money(pnl.totals.cogs.actual)} actual vs ${money(pnl.totals.cogs.budget)} budget`);
  L.push(`- Expenses:${money(pnl.totals.expense.actual)} actual vs ${money(pnl.totals.expense.budget)} budget`);
  L.push(`- Gross profit: ${money(pnl.gross.actual)} (budget ${money(pnl.gross.budget)})`);
  L.push(`- Net profit:   ${money(pnl.net.actual)} (budget ${money(pnl.net.budget)})`);
  const exp = (pnl.sections.expense || []).slice().sort((a, b) => b.actual - a.actual).slice(0, 6);
  if (exp.length) {
    L.push('Top expense categories (actual vs budget):');
    exp.forEach((r) => {
      const v = r.variance;
      const tag = v > 0.005 ? ` — OVER by ${money(v)}` : v < -0.005 ? ` — under by ${money(-v)}` : '';
      L.push(`  • ${(r.category && r.category.name) || 'Uncategorized'}: ${money(r.actual)} vs ${money(r.budget)}${tag}`);
    });
  }
  if (!plan) L.push('(No active budget plan set — the budget figures are 0; these are actuals only.)');
  return L.join('\n');
}
