#!/usr/bin/env node
/**
 * build-local-fonts.mjs
 * ─────────────────────
 * Generates self-hosted font CSS from every installed @fontsource-variable/*
 * package, so slab stops depending on fonts.googleapis.com (no third-party
 * round trip, no FOUT, works offline).
 *
 * For each package it:
 *   1. reads metadata.json for the real family name ("Jost Variable" → "Jost")
 *   2. concatenates index.css + wght-italic.css (when the font ships italics)
 *   3. REWRITES the font-family back to the plain name — this is the trick that
 *      makes it a drop-in: every template/skin already says font-family:'Jost',
 *      so nothing downstream has to change.
 *   4. rewrites url(./files/…) → /vendor/fonts/<pkg>/files/… (served by app.js)
 *   5. writes public/fonts/<pkg>.css
 *
 * Finally it writes config/local-fonts.json — a manifest mapping the display
 * name → css href. app.js loads this into app.locals.localFonts and
 * partials/font-vars.ejs prefers a local font over Google when one exists.
 *
 * Re-run after installing new @fontsource-variable packages:
 *   node scripts/build-local-fonts.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', '@fontsource-variable');
const outDir = join(root, 'public', 'fonts');
const manifestPath = join(root, 'config', 'local-fonts.json');

if (!existsSync(srcDir)) {
  console.error('No @fontsource-variable packages installed. Nothing to do.');
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });

const manifest = {};
for (const pkg of readdirSync(srcDir).sort()) {
  const pkgDir = join(srcDir, pkg);
  const metaPath = join(pkgDir, 'metadata.json');
  const cssPath = join(pkgDir, 'index.css');
  if (!existsSync(metaPath) || !existsSync(cssPath)) continue;

  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  // "Jost Variable" → "Jost" (matches the names in the design panel / FONT_MAP)
  const family = String(meta.family || pkg).replace(/\s+Variable$/i, '').trim();

  let css = readFileSync(cssPath, 'utf8');
  const italicPath = join(pkgDir, 'wght-italic.css');
  if (existsSync(italicPath)) css += '\n' + readFileSync(italicPath, 'utf8');

  css = css
    // 'Jost Variable' → 'Jost' so existing font stacks resolve unchanged
    .replace(/font-family:\s*(['"])([^'"]+?)\s+Variable\1/g, "font-family: $1$2$1")
    // relative file urls → the express vendor mount
    .replace(/url\(\.\/files\//g, `url(/vendor/fonts/${pkg}/files/`);

  writeFileSync(join(outDir, `${pkg}.css`), css);
  manifest[family] = `/fonts/${pkg}.css`;
  console.log(`✓ ${family.padEnd(24)} → public/fonts/${pkg}.css`);
}

/* ── static (non-variable) @fontsource packages: concatenate the useful
   weights (300–800 + italics). unicode-range keeps actual downloads lean. ── */
const staticDir = join(root, 'node_modules', '@fontsource');
if (existsSync(staticDir)) {
  const WEIGHTS = [300, 400, 500, 600, 700, 800];
  for (const pkg of readdirSync(staticDir).sort()) {
    const pkgDir = join(staticDir, pkg);
    const metaPath = join(pkgDir, 'metadata.json');
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const family = String(meta.family || pkg).trim();
    if (manifest[family]) continue; // variable version wins
    let css = '';
    for (const w of WEIGHTS) {
      for (const suffix of ['', '-italic']) {
        const p = join(pkgDir, w + suffix + '.css');
        if (existsSync(p)) css += readFileSync(p, 'utf8') + '\n';
      }
    }
    if (!css) continue;
    css = css.replace(/url\(\.\/files\//g, `url(/vendor/fonts-static/${pkg}/files/`);
    writeFileSync(join(outDir, `${pkg}.css`), css);
    manifest[family] = `/fonts/${pkg}.css`;
    console.log(`✓ ${family.padEnd(24)} → public/fonts/${pkg}.css (static weights)`);
  }
}

mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${Object.keys(manifest).length} fonts self-hosted. Manifest → config/local-fonts.json`);
