#!/usr/bin/env node
/**
 * Slab Docs Audit — run via cron or manually
 *
 * 1. Finds CLAUDE.md files older than 14 days
 * 2. Detects directories with code changes newer than their CLAUDE.md
 * 3. Generates README.md TLDRs via Ollama for dirs that have CLAUDE.md but no README
 *
 * Usage:
 *   node scripts/docs-audit.js                # audit only (dry run)
 *   node scripts/docs-audit.js --generate     # audit + generate missing READMEs via Ollama
 *
 * Output: /srv/slab/docs/STALE_DOCS.md
 */

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';

const ROOT = '/srv/slab';
const STALE_DAYS = 14;
const GENERATE = process.argv.includes('--generate');
const OLLAMA_URL = process.env.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions';
const OLLAMA_KEY = process.env.OLLAMA_KEY || '';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

const SKIP_DIRS = ['node_modules', '.git', 'public', '.env'];
const CODE_EXTS = ['.js', '.ejs', '.json', '.md'];

// ── Find all CLAUDE.md files ─────────────────────────────────────────────────

function findFiles(dir, name, results = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) findFiles(full, name, results);
      else if (entry.name === name) results.push(full);
    }
  } catch {}
  return results;
}

function getNewestCodeFile(dir) {
  let newest = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = getNewestCodeFile(full);
        if (sub > newest) newest = sub;
      } else if (CODE_EXTS.some(ext => entry.name.endsWith(ext)) && !entry.name.includes('CLAUDE') && !entry.name.includes('README')) {
        const mt = statSync(full).mtimeMs;
        if (mt > newest) newest = mt;
      }
    }
  } catch {}
  return newest;
}

// ── Ollama README generation ─────────────────────────────────────────────────

async function generateReadme(claudePath) {
  const content = readFileSync(claudePath, 'utf8');
  const dir = dirname(claudePath);
  const relDir = relative(ROOT, dir) || 'root';

  const messages = [
    {
      role: 'system',
      content: 'You write concise README.md files. Given a CLAUDE.md (AI context doc), produce a short human-readable README. Keep it under 40 lines. No emojis. Include: purpose, key files, quick reference. Respond with ONLY the markdown content.',
    },
    {
      role: 'user',
      content: `Write a README.md for the "${relDir}" directory based on this CLAUDE.md:\n\n${content}`,
    },
  ];

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(OLLAMA_KEY ? { Authorization: `Bearer ${OLLAMA_KEY}` } : {}),
      },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, temperature: 0.3 }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error(`  [ollama] Failed for ${relDir}:`, err.message);
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function audit() {
  const now = Date.now();
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
  const claudes = findFiles(ROOT, 'CLAUDE.md');

  const stale = [];
  const drifted = [];
  const missingReadme = [];

  for (const cp of claudes) {
    const dir = dirname(cp);
    const rel = relative(ROOT, cp);
    const claudeStat = statSync(cp);
    const age = now - claudeStat.mtimeMs;
    const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));

    // Check staleness
    if (age > staleMs) {
      stale.push({ path: rel, ageDays });
    }

    // Check if code is newer than CLAUDE
    const newestCode = getNewestCodeFile(dir);
    if (newestCode > claudeStat.mtimeMs) {
      const driftDays = Math.floor((newestCode - claudeStat.mtimeMs) / (24 * 60 * 60 * 1000));
      drifted.push({ path: rel, driftDays });
    }

    // Check if README exists
    const readmePath = join(dir, 'README.md');
    if (!existsSync(readmePath)) {
      missingReadme.push({ claudePath: cp, dir: relative(ROOT, dir) || 'root' });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const lines = [
    `# Docs Audit — ${new Date().toISOString().split('T')[0]}`,
    '',
  ];

  if (stale.length) {
    lines.push(`## Stale CLAUDE.md (>${STALE_DAYS} days)`);
    for (const s of stale) lines.push(`- \`${s.path}\` — ${s.ageDays} days old`);
    lines.push('');
  }

  if (drifted.length) {
    lines.push('## Code Changed Since CLAUDE.md Updated');
    for (const d of drifted) lines.push(`- \`${d.path}\` — code is ${d.driftDays} days newer`);
    lines.push('');
  }

  if (missingReadme.length) {
    lines.push('## Missing README.md (has CLAUDE.md but no README)');
    for (const m of missingReadme) lines.push(`- \`${m.dir}/\``);
    lines.push('');
  }

  if (!stale.length && !drifted.length && !missingReadme.length) {
    lines.push('All docs are up to date.');
  }

  const report = lines.join('\n');
  writeFileSync(join(ROOT, 'docs/STALE_DOCS.md'), report);
  console.log(report);

  // ── Generate missing READMEs ──────────────────────────────────────────────
  if (GENERATE && missingReadme.length) {
    console.log(`\nGenerating ${missingReadme.length} READMEs via Ollama...\n`);
    for (const m of missingReadme) {
      console.log(`  Generating: ${m.dir}/README.md`);
      const readme = await generateReadme(m.claudePath);
      if (readme) {
        writeFileSync(join(ROOT, m.dir === 'root' ? '' : m.dir, 'README.md'), readme);
        console.log(`  [OK] ${m.dir}/README.md`);
      }
    }
  }
}

audit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
