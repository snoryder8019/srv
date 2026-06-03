import fs from 'fs';
const F = '/srv/tiles/public/js/casino-fx.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('renderBreakdown')) { console.log('already'); process.exit(0); }

const D = String.fromCharCode(36);   // '$' — avoid template interpolation in this patch
const anchor = '      ' + D + '{deltaHtml}\n      ' + D + '{opts.balance != null ?';
const inject = '      ' + D + '{deltaHtml}\n      ' + D + '{renderBreakdown(opts.breakdown)}\n      ' + D + '{opts.balance != null ?';
if (!s.includes(anchor)) { console.log('anchor not found'); process.exit(1); }
s = s.replace(anchor, inject);

const helper = [
  'function renderBreakdown(list) {',
  '  if (!Array.isArray(list) || !list.length) return "";',
  '  const rows = list.map((r) => {',
  '    const pos = r.delta > 0;',
  '    const col = pos ? "#3fd07f" : (r.delta < 0 ? "#ff6f52" : "#9fb0a6");',
  '    const label = (r.label || r.side || "").toString().toUpperCase();',
  '    const amt = (pos ? "+" : "") + r.delta;',
  '    return "<div style=\\"display:flex;justify-content:space-between;gap:18px;font-size:13px;color:" + col + "\\">"',
  '      + "<span style=\\"letter-spacing:.08em\\">" + label + "</span>"',
  '      + "<span style=\\"font-weight:700\\">" + amt + "</span></div>";',
  '  }).join("");',
  '  return "<div style=\\"margin-top:10px;border-top:1px solid rgba(255,255,255,.12);padding-top:8px;display:flex;flex-direction:column;gap:3px\\">" + rows + "</div>";',
  '}',
  '',
  'export function showResult(opts = {}) {',
].join('\n');
s = s.replace('export function showResult(opts = {}) {', helper);

fs.writeFileSync(F, s);
console.log('casino-fx: breakdown helper added + wired into showResult');
