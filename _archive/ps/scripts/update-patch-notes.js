import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PATCH_NOTES_DIR = path.join(__dirname, '../docs');
const MAIN_PATCH_NOTES = path.join(PATCH_NOTES_DIR, 'PATCH_NOTES_v0.4.md');

/**
 * Update Patch Notes from Git History
 *
 * This script analyzes recent git commits and updates patch notes
 * with new changes, bug fixes, and features.
 */

async function getRecentCommits(count = 10) {
  try {
    const { stdout } = await execPromise(
      `git log --pretty=format:"%h|%ai|%an|%s" -${count}`,
      { cwd: path.join(__dirname, '..') }
    );

    const commits = stdout.split('\n').map(line => {
      const [hash, date, author, message] = line.split('|');
      return { hash, date, author, message };
    });

    return commits;
  } catch (error) {
    console.error('Error fetching git commits:', error);
    return [];
  }
}

async function getCommitStats(commitHash) {
  try {
    const { stdout } = await execPromise(
      `git show --stat --pretty=format:"" ${commitHash}`,
      { cwd: path.join(__dirname, '..') }
    );

    const lines = stdout.trim().split('\n').filter(l => l.trim());
    const summary = lines[lines.length - 1];

    // Parse something like: "87 files changed, 26533 insertions(+), 184 deletions(-)"
    const match = summary.match(/(\d+) files? changed,\s*(\d+) insertions?\(\+\),\s*(\d+) deletions?\(-\)/);

    if (match) {
      return {
        filesChanged: parseInt(match[1]),
        insertions: parseInt(match[2]),
        deletions: parseInt(match[3])
      };
    }

    return null;
  } catch (error) {
    console.error(`Error getting stats for commit ${commitHash}:`, error);
    return null;
  }
}

async function getCommitChangedFiles(commitHash) {
  try {
    const { stdout } = await execPromise(
      `git show --name-only --pretty=format:"" ${commitHash}`,
      { cwd: path.join(__dirname, '..') }
    );

    return stdout.trim().split('\n').filter(f => f.trim());
  } catch (error) {
    console.error(`Error getting changed files for commit ${commitHash}:`, error);
    return [];
  }
}

function categorizeFiles(files) {
  const categories = {
    frontend: [],
    backend: [],
    views: [],
    scripts: [],
    docs: [],
    config: [],
    other: []
  };

  files.forEach(file => {
    if (file.includes('public/javascripts/') || file.includes('public/stylesheets/')) {
      categories.frontend.push(file);
    } else if (file.includes('api/') || file.includes('routes/') || file.includes('services/')) {
      categories.backend.push(file);
    } else if (file.includes('views/')) {
      categories.views.push(file);
    } else if (file.includes('scripts/')) {
      categories.scripts.push(file);
    } else if (file.includes('docs/') || file.endsWith('.md')) {
      categories.docs.push(file);
    } else if (file.includes('config/') || file === 'package.json') {
      categories.config.push(file);
    } else {
      categories.other.push(file);
    }
  });

  return categories;
}

async function generatePatchNotesSummary() {
  console.log('📝 Generating patch notes summary from git history...');

  const commits = await getRecentCommits(10);

  if (commits.length === 0) {
    console.log('⚠️  No recent commits found');
    return null;
  }

  console.log(`📊 Analyzing ${commits.length} recent commits...`);

  let summary = `# Recent Changes Summary\n\n`;
  summary += `Generated: ${new Date().toISOString()}\n\n`;
  summary += `---\n\n`;

  for (const commit of commits.slice(0, 5)) {
    const stats = await getCommitStats(commit.hash);
    const files = await getCommitChangedFiles(commit.hash);
    const categories = categorizeFiles(files);

    summary += `## Commit: ${commit.message}\n\n`;
    summary += `- **Hash:** \`${commit.hash}\`\n`;
    summary += `- **Author:** ${commit.author}\n`;
    summary += `- **Date:** ${new Date(commit.date).toLocaleDateString()}\n`;

    if (stats) {
      summary += `- **Changes:** ${stats.filesChanged} files, +${stats.insertions}/-${stats.deletions} lines\n`;
    }

    summary += `\n### Modified Areas:\n\n`;

    if (categories.frontend.length > 0) {
      summary += `**Frontend:** ${categories.frontend.length} files\n`;
    }
    if (categories.backend.length > 0) {
      summary += `**Backend:** ${categories.backend.length} files\n`;
    }
    if (categories.views.length > 0) {
      summary += `**Views:** ${categories.views.length} files\n`;
    }
    if (categories.scripts.length > 0) {
      summary += `**Scripts:** ${categories.scripts.length} files\n`;
    }
    if (categories.docs.length > 0) {
      summary += `**Documentation:** ${categories.docs.length} files\n`;
    }

    summary += `\n---\n\n`;
  }

  return summary;
}

async function updatePatchNotesIndex() {
  console.log('📋 Updating patch notes index...');

  try {
    // Read all patch note files
    const files = await fs.readdir(PATCH_NOTES_DIR);
    const patchNoteFiles = files
      .filter(f => f.startsWith('PATCH_NOTES_') && f.endsWith('.md'))
      .sort()
      .reverse();

    console.log(`📄 Found ${patchNoteFiles.length} patch note files`);

    // Create index
    let index = `# Patch Notes Index\n\n`;
    index += `Last Updated: ${new Date().toISOString()}\n\n`;
    index += `---\n\n`;
    index += `## Available Versions\n\n`;

    for (const file of patchNoteFiles) {
      // Extract version from filename
      const versionMatch = file.match(/PATCH_NOTES_v(.+)\.md/);
      if (versionMatch) {
        const version = versionMatch[1];

        // Read first few lines to get title
        const content = await fs.readFile(path.join(PATCH_NOTES_DIR, file), 'utf-8');
        const lines = content.split('\n');
        const titleLine = lines.find(l => l.startsWith('# Patch Notes'));

        index += `- [Version ${version}](${file})`;
        if (titleLine) {
          const title = titleLine.replace('# Patch Notes - ', '').replace('# ', '');
          index += ` - ${title}`;
        }
        index += `\n`;
      }
    }

    index += `\n---\n\n`;
    index += `## Quick Links\n\n`;
    index += `- [Current Version](PATCH_NOTES_v0.4.md) - Latest active version\n`;
    index += `- [Documentation Hub](/help/documentation) - All game documentation\n`;
    index += `- [Developer Letter](DEVELOPER_LETTER_v0.4.md) - Vision and roadmap\n`;

    // Write index
    const indexPath = path.join(PATCH_NOTES_DIR, 'PATCH_NOTES_INDEX.md');
    await fs.writeFile(indexPath, index, 'utf-8');

    console.log(`✅ Patch notes index updated: ${indexPath}`);

    return {
      totalVersions: patchNoteFiles.length,
      indexPath
    };
  } catch (error) {
    console.error('Error updating patch notes index:', error);
    throw error;
  }
}

async function generateChangelogEntry() {
  console.log('📝 Generating changelog entry...');

  const commits = await getRecentCommits(5);

  let changelog = `## Latest Changes (${new Date().toLocaleDateString()})\n\n`;

  for (const commit of commits) {
    changelog += `- **${commit.message}** (${commit.hash}) - ${commit.author}\n`;
  }

  changelog += `\n`;

  return changelog;
}

async function updatePatchNotes() {
  try {
    console.log('🚀 Starting patch notes update process...');

    // Generate summary
    const summary = await generatePatchNotesSummary();
    let summaryPath = null;

    if (summary) {
      // Save summary to file
      summaryPath = path.join(PATCH_NOTES_DIR, 'RECENT_CHANGES.md');
      await fs.writeFile(summaryPath, summary, 'utf-8');
      console.log(`✅ Recent changes summary saved: ${summaryPath}`);
    }

    // Update index
    const indexResult = await updatePatchNotesIndex();

    // Generate changelog entry
    const changelogEntry = await generateChangelogEntry();
    const changelogPath = path.join(PATCH_NOTES_DIR, 'CHANGELOG_LATEST.md');
    await fs.writeFile(changelogPath, changelogEntry, 'utf-8');
    console.log(`✅ Latest changelog saved: ${changelogPath}`);

    console.log('✅ Patch notes update complete!');
    console.log(`📊 Summary:`);
    console.log(`   - Versions indexed: ${indexResult.totalVersions}`);
    console.log(`   - Index file: ${indexResult.indexPath}`);
    if (summaryPath) {
      console.log(`   - Recent changes: ${summaryPath}`);
    }
    console.log(`   - Latest changelog: ${changelogPath}`);

    return {
      success: true,
      summary,
      indexResult,
      changelogEntry
    };
  } catch (error) {
    console.error('❌ Error updating patch notes:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updatePatchNotes()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export default updatePatchNotes;
