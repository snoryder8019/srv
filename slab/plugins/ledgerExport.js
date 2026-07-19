/**
 * Ledger export — turns the P&L and Budget data into a financial spreadsheet.
 *
 * Two output paths share one builder each so the .xlsx and the print/CSV views
 * never drift: buildPnlRows() / buildBudgetRows() produce a plain matrix, then
 * we render that either into an ExcelJS workbook (styled .xlsx) or CSV text.
 *
 * Consumed by routes/admin/ledger.js — the export routes there are behind the
 * same `ledger` feature permission gate as the rest of /admin/ledger.
 */
import ExcelJS from 'exceljs';
import { PNL_TYPES, FIXED_BUDGET_TYPES } from './ledgerHelpers.js';

const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// ── P&L ───────────────────────────────────────────────────────────────────────
// Returns { columns, rows } where each row is { cells:[...], kind } and kind is
// 'section' | 'line' | 'total' | 'grand' | 'blank' for styling. Each numeric row
// carries the on-screen comparison columns too: % of budget attainment, the
// prior-period actual, and the % change vs that prior period. Percent cells are
// pre-formatted strings ('120%', '+50.0%', '—') so CSV/print stay readable and
// the xlsx leaves them as text.
const pctBud = (r) => (r.budgetPct != null ? Math.round(r.budgetPct) + '%' : '—');
const varPrev = (r) => n2((r.actual || 0) - (r.prev || 0)); // signed $ variance vs prior period

export function buildPnlRows(pnl, { GL_TYPE_LABELS = {}, compareLabel = 'Prior' } = {}) {
  const rows = [];
  const line = (label, r) => rows.push({ kind: 'line', cells: [label, n2(r.actual), n2(r.budget), pctBud(r), n2(r.variance), n2(r.prev), varPrev(r)] });
  const total = (label, t) => rows.push({ kind: 'total', cells: [label, n2(t.actual), n2(t.budget), pctBud(t), n2(t.actual - t.budget), n2(t.prev), varPrev(t)] });
  const grand = (label, g) => rows.push({ kind: 'grand', cells: [label, n2(g.actual), n2(g.budget), pctBud(g), n2(g.actual - g.budget), n2(g.prev), varPrev(g)] });
  const section = (label) => rows.push({ kind: 'section', cells: [label, '', '', '', '', '', ''] });
  const blank = () => rows.push({ kind: 'blank', cells: ['', '', '', '', '', '', ''] });

  section(GL_TYPE_LABELS.income || 'Income');
  for (const r of pnl.sections.income) line(r.category.name, r);
  total('Total Income', pnl.totals.income);
  blank();

  section(GL_TYPE_LABELS.cogs || 'Cost of Goods Sold');
  for (const r of pnl.sections.cogs) line(r.category.name, r);
  total('Total COGS', pnl.totals.cogs);
  blank();

  grand('Gross Profit', pnl.gross);
  blank();

  if (pnl.sections.labor && pnl.sections.labor.length) {
    section(GL_TYPE_LABELS.labor || 'Labor');
    for (const r of pnl.sections.labor) line(r.category.name, r);
    total('Total Labor', pnl.totals.labor);
    blank();
  }

  if (pnl.sections.fixed && pnl.sections.fixed.length) {
    section(GL_TYPE_LABELS.fixed || 'Fixed Costs');
    for (const r of pnl.sections.fixed) line(r.category.name, r);
    total('Total Fixed Costs', pnl.totals.fixed);
    blank();
  }

  section(GL_TYPE_LABELS.expense || 'Operating Expenses');
  for (const r of pnl.sections.expense) line(r.category.name, r);
  total('Total Expenses', pnl.totals.expense);
  blank();

  grand('Net Profit', pnl.net);

  return { columns: ['Account', 'Actual', 'Budget', '% of Bud', 'Variance', compareLabel, `Δ vs ${compareLabel}`], rows };
}

// ── Budget ────────────────────────────────────────────────────────────────────
export function buildBudgetRows(plan, categories, { GL_TYPE_LABELS = {} } = {}) {
  const revenue = Number(plan?.projectedRevenue) || 0;
  const pctByCat = {};
  const amtByCat = {};
  for (const l of plan?.lines || []) {
    if (l.amount != null) amtByCat[String(l.categoryId)] = Number(l.amount) || 0;
    else pctByCat[String(l.categoryId)] = Number(l.pct) || 0;
  }

  const byType = {};
  for (const t of PNL_TYPES) byType[t] = [];
  for (const c of categories) if (byType[c.type]) byType[c.type].push(c);

  const rows = [];
  const section = (label) => rows.push({ kind: 'section', cells: [label, '', ''] });
  const blank = () => rows.push({ kind: 'blank', cells: ['', '', ''] });

  rows.push({ kind: 'grand', cells: ['Projected Annual Revenue', '', n2(revenue)] });
  const q = plan?.quarters || [0, 0, 0, 0];
  rows.push({ kind: 'total', cells: ['Quarterly split (Q1–Q4)', '', `${n2(q[0])} / ${n2(q[1])} / ${n2(q[2])} / ${n2(q[3])}`] });
  blank();

  for (const type of PNL_TYPES) {
    if (!byType[type].length) continue;
    const isFixed = FIXED_BUDGET_TYPES.includes(type);
    section(GL_TYPE_LABELS[type] || type);
    let secPct = 0, secAmt = 0;
    for (const c of byType[type]) {
      if (isFixed) {
        const amt = n2(amtByCat[String(c._id)] || 0);
        secAmt += amt;
        rows.push({ kind: 'line', cells: [c.name, 'fixed', amt] });
      } else {
        const pct = pctByCat[String(c._id)] || 0;
        const amt = n2(revenue * (pct / 100));
        secPct += pct; secAmt += amt;
        rows.push({ kind: 'line', cells: [c.name, pct, amt] });
      }
    }
    rows.push({ kind: 'total', cells: [`Total ${GL_TYPE_LABELS[type] || type}`, isFixed ? '' : n2(secPct), n2(secAmt)] });
    blank();
  }

  return { columns: ['Account', '% of Revenue', 'Budgeted $'], rows };
}

// ── CSV rendering ─────────────────────────────────────────────────────────────
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function rowsToCsv({ columns, rows }) {
  const out = [columns.map(csvCell).join(',')];
  for (const r of rows) out.push(r.cells.map(csvCell).join(','));
  return out.join('\n');
}

// ── XLSX rendering ─────────────────────────────────────────────────────────────
const NAVY = 'FF1C2B4A';
const GOLD = 'FFC9A848';
const IVORY = 'FFF5F3EF';
const MONEY_FMT = '$#,##0.00;[Red]-$#,##0.00';

async function matrixToXlsxBuffer({ columns, rows }, { sheetName, title, subtitle, moneyCols }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'sLab';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 0 }] });

  const lastCol = columns.length;
  const colLetter = String.fromCharCode(64 + lastCol);

  // Title band
  ws.mergeCells(`A1:${colLetter}1`);
  const tCell = ws.getCell('A1');
  tCell.value = title;
  tCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: NAVY } };
  tCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  if (subtitle) {
    ws.mergeCells(`A2:${colLetter}2`);
    const sCell = ws.getCell('A2');
    sCell.value = subtitle;
    sCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6B7280' } };
  }

  // Header row
  const headerRowIdx = subtitle ? 4 : 3;
  const header = ws.getRow(headerRowIdx);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: GOLD } } };
  });
  header.height = 18;

  // Data rows
  let r = headerRowIdx + 1;
  for (const row of rows) {
    const xr = ws.getRow(r);
    row.cells.forEach((val, i) => {
      const cell = xr.getCell(i + 1);
      cell.value = val === '' ? null : val;
      cell.alignment = { horizontal: i === 0 ? 'left' : 'right' };
      if (i > 0 && moneyCols.includes(i) && typeof val === 'number') cell.numFmt = MONEY_FMT;

      if (row.kind === 'section') {
        cell.font = { bold: true, color: { argb: NAVY }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IVORY } };
      } else if (row.kind === 'total') {
        cell.font = { bold: true, color: { argb: NAVY } };
        cell.border = { top: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
      } else if (row.kind === 'grand') {
        cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
      }
    });
    xr.height = row.kind === 'grand' ? 20 : 16;
    r += 1;
  }

  ws.getColumn(1).width = 40;
  for (let i = 2; i <= lastCol; i++) ws.getColumn(i).width = 18;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function pnlXlsxBuffer(pnl, { label, brandName, GL_TYPE_LABELS, compareLabel }) {
  const matrix = buildPnlRows(pnl, { GL_TYPE_LABELS, compareLabel });
  return matrixToXlsxBuffer(matrix, {
    sheetName: 'Profit & Loss',
    title: `${brandName || 'Business'} — Profit & Loss`,
    subtitle: `${label} · generated ${new Date().toLocaleDateString('en-US')}`,
    moneyCols: [1, 2, 4, 5, 6],
  });
}

export function budgetXlsxBuffer(plan, categories, { year, brandName, GL_TYPE_LABELS }) {
  const matrix = buildBudgetRows(plan, categories, { GL_TYPE_LABELS });
  return matrixToXlsxBuffer(matrix, {
    sheetName: `Budget ${year}`,
    title: `${brandName || 'Business'} — Budget ${year}`,
    subtitle: `${plan?.name || year + ' Plan'} · generated ${new Date().toLocaleDateString('en-US')}`,
    moneyCols: [2],
  });
}
