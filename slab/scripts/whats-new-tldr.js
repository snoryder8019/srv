#!/usr/bin/env node
// whats-new-tldr.js — Summarize recent git commits via Ollama, save to changelog
//
// Cron: Monday 6am MST (1pm UTC)
//   0 13 * * 1  cd /srv/slab && node scripts/whats-new-tldr.js >> scripts/whats-new.log 2>&1
//
// Usage: node scripts/whats-new-tldr.js [--since "1 week ago"]

import { execSync } from 'child_process';
import { connectDB, getSlabDb } from '../plugins/mongo.js';
import { callLLM } from '../plugins/agentMcp.js';

const sinceArg = process.argv.find(a => a === '--since');
const sinceVal = sinceArg ? process.argv[process.argv.indexOf('--since') + 1] : '2 weeks ago';

async function main() {
  console.log(`[whats-new] Starting TLDR generation (since: ${sinceVal})`);
  await connectDB();
  const slab = getSlabDb();

  // Get commits with stats and file changes
  const gitLog = execSync(
    `git log main --since="${sinceVal}" --pretty=format:"===COMMIT===|%H|%h|%s|%ai|%an" --stat -- slab/`,
    { encoding: 'utf8', timeout: 10000, cwd: '/srv' }
  ).trim();

  if (!gitLog) {
    console.log('[whats-new] No commits found');
    process.exit(0);
  }

  // Parse into commit objects
  const commits = [];
  const blocks = gitLog.split('===COMMIT===').filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const header = lines[0];
    const [, hash, short, message, dateStr, author] = header.split('|');
    const statsLines = lines.slice(1).filter(l => l.trim());

    commits.push({
      hash, short, message, dateStr, author,
      stats: statsLines.join('\n'),
    });
  }

  console.log(`[whats-new] Found ${commits.length} commits to summarize`);

  // Also get actual diffs (abbreviated) for each commit for better context
  for (const c of commits) {
    try {
      const diff = execSync(
        `git diff ${c.hash}~1..${c.hash} --stat --shortstat -- slab/ 2>/dev/null || echo "initial commit"`,
        { encoding: 'utf8', timeout: 5000, cwd: '/srv' }
      ).trim();
      c.diffSummary = diff.slice(0, 500);
    } catch {
      c.diffSummary = c.stats;
    }
  }

  // Build the prompt with all commits
  const commitText = commits.map(c =>
    `### ${c.short} — ${c.message} (${c.dateStr}, ${c.author})\nFiles changed:\n${c.diffSummary}`
  ).join('\n\n');

  const systemPrompt = `You are a technical changelog writer for a SaaS platform called sLab.
Your job is to read git commit data and produce a clean, user-friendly "What's New" summary.

Rules:
- Group related commits into logical features/changes
- Use bullet points for each change
- Be specific about WHAT changed (mention modules, pages, features by name)
- Skip noise like "good push" or generic messages — infer meaning from file changes
- Use present tense ("Adds", "Fixes", "Updates")
- Include a version tag if one appears in a commit message
- Keep it concise but informative — 2-4 bullet points per group
- Format as clean markdown
- Do NOT invent features — only describe what the commits actually show`;

  const userMessage = `Here are the recent git commits for sLab. Summarize them into a "What's New" changelog with bullet points grouped by feature area:

${commitText}

Write the changelog now:`;

  console.log('[whats-new] Calling Ollama for TLDR...');

  let summary;
  try {
    summary = await callLLM(
      [{ role: 'user', content: userMessage }],
      systemPrompt
    );
    console.log('[whats-new] Got summary from Ollama');
  } catch (err) {
    console.error('[whats-new] Ollama call failed:', err.message);
    // Fallback: generate a simple bullet list without AI
    summary = commits.map(c => `- **${c.short}** ${c.message}`).join('\n');
    console.log('[whats-new] Using fallback bullet list');
  }

  // Convert markdown to simple HTML for the EJS view
  const htmlSummary = summary
    .replace(/^### (.+)$/gm, '<strong style="display:block;margin-top:10px;">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="display:block;margin-top:12px;font-size:1em;">$1</strong>')
    .replace(/^\*\*(.+?)\*\*/gm, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;margin-bottom:3px;">$1</li>')
    .replace(/^• (.+)$/gm, '<li style="margin-left:16px;margin-bottom:3px;">$1</li>')
    .replace(/\n/g, '\n');

  // Save to changelog collection — one entry per run, keyed by date range
  const now = new Date();
  const weekKey = `tldr-${now.toISOString().slice(0, 10)}`;

  await slab.collection('changelog').updateOne(
    { commitHash: weekKey },
    {
      $set: {
        commitHash: weekKey,
        type: 'tldr',
        notes: htmlSummary,
        rawMarkdown: summary,
        commitCount: commits.length,
        commitRange: {
          from: commits[commits.length - 1]?.short || '',
          to: commits[0]?.short || '',
        },
        since: sinceVal,
        updatedAt: now,
        addedBy: 'whats-new-cron',
      },
    },
    { upsert: true },
  );

  // Also save individual commit notes for the settings page pin view
  for (const c of commits) {
    await slab.collection('changelog').updateOne(
      { commitHash: c.hash },
      {
        $setOnInsert: {
          commitHash: c.hash,
          type: 'commit',
          notes: null,
          addedBy: 'whats-new-cron',
        },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );
  }

  console.log('[whats-new] Saved to changelog collection');
  console.log('\n=== TLDR ===');
  console.log(summary);
  console.log('============\n');

  process.exit(0);
}

main().catch(err => {
  console.error('[whats-new] Fatal:', err);
  process.exit(1);
});
