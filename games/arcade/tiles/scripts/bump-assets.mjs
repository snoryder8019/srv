#!/usr/bin/env node
/**
 * bump-assets.mjs — ONE command to cache-bust every client asset together.
 *
 * The doctrine: there is ONE asset version across the whole tiles client. Every
 * `?v=<n>` in the ES-module import graph (public/js/*.js) and every entry
 * `<script src=".../*.js?v=<n>">` in public/*.html is rewritten to a single fresh
 * stamp. No more hand-picking numbers per import (which stranded edits behind
 * stale stamps — e.g. all 7 games pinned table3d.js to one old version).
 *
 * Run after ANY client JS edit, before/with a deploy:
 *     node scripts/bump-assets.mjs
 *
 * Use --check to verify consistency WITHOUT writing (CI / pre-deploy guard):
 *     node scripts/bump-assets.mjs --check
 *
 * Backups (*.bak*, *.retired*, *.cambak*, *.*bak*) are skipped — only live
 * .js / .html are touched.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'public');
const JS_DIR = path.join(ROOT, 'js');

const CHECK = process.argv.includes('--check');
const STAMP = String(Date.now());
const V_RE = /\?v=\d+/g;

// A live asset is exactly *.js or *.html — never a timestamped backup.
const isLiveJs = (f) => /\.js$/.test(f) && !/\.(bak|retired|cambak)/.test(f) && !/\.js\./.test(f);
const isLiveHtml = (f) => /\.html$/.test(f) && !/\.html\./.test(f);

function collect() {
  const out = [];
  for (const f of fs.readdirSync(JS_DIR)) if (isLiveJs(f)) out.push(path.join(JS_DIR, f));
  for (const f of fs.readdirSync(ROOT)) if (isLiveHtml(f)) out.push(path.join(ROOT, f));
  return out;
}

const files = collect();
const stamps = new Set();
let touched = 0, occurrences = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.match(V_RE) || [];
  hits.forEach((h) => stamps.add(h.slice(3)));
  occurrences += hits.length;
  if (!hits.length) continue;
  if (CHECK) continue;
  const next = src.replace(V_RE, '?v=' + STAMP);
  if (next !== src) { fs.writeFileSync(file, next); touched++; }
}

if (CHECK) {
  const distinct = [...stamps];
  if (distinct.length <= 1) {
    console.log(`✓ assets consistent — ${occurrences} ?v= refs at ${distinct[0] || '(none)'}`);
    process.exit(0);
  }
  console.error(`✗ asset drift — ${distinct.length} distinct stamps across ${files.length} files:`);
  console.error('  ' + distinct.sort().join('\n  '));
  process.exit(1);
}

console.log(`✓ bumped ${occurrences} ?v= refs in ${touched} files → ?v=${STAMP}`);
console.log(`  (was ${stamps.size} distinct stamp${stamps.size === 1 ? '' : 's'})`);
