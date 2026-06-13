import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate Documentation Tree
 *
 * This script scans the docs directory and generates a structured
 * documentation tree with categories, files, and metadata.
 */

const DOCS_DIR = path.join(__dirname, '../docs');
const OUTPUT_FILE = path.join(__dirname, '../public/data/docs-tree.json');

// Category mappings based on subdirectory and file patterns
const DIRECTORY_CATEGORIES = {
  'guides': 'Guides & Tutorials',
  'reference': 'Quick References',
  'systems': 'Systems & Features',
  'summaries': 'Implementation Summaries',
  'architecture': 'Architecture & Scaling',
  'session-notes': 'Session Notes',
  'archive': 'Archive'
};

// Fallback file-based category mappings
const CATEGORY_MAP = {
  'PROJECT_OVERVIEW': 'Getting Started',
  'CLAUDE': 'Getting Started',
  'README': 'Getting Started',
  'ROADMAP': 'Getting Started',
  'TESTER_QUICK_REFERENCE': 'Quick References',
  'TESTER_SYSTEM_COMPLETE': 'Guides & Tutorials',
  'ASSET_BUILDER_COMPLETE': 'Guides & Tutorials',
  'GALACTIC_MAP_COMPLETE': 'Guides & Tutorials',
  'LOCATION_SYSTEM_IMPLEMENTATION': 'Guides & Tutorials',
  'ANALYTICS_SYSTEM': 'Systems & Features',
  'USER_CHARACTER_REFERENCE': 'Quick References',
  'MENU_SYSTEM': 'Quick References',
  'STATUS_BAR_README': 'Quick References',
  'TESTING_KEY': 'Quick References',
  'DOCUMENTATION_SYSTEM': 'Guides & Tutorials',
  'COORDINATE_SYSTEM': 'Systems & Features'
};

// Priority order for display
const CATEGORY_ORDER = [
  'Getting Started',
  'Quick References',
  'Guides & Tutorials',
  'Systems & Features',
  'Implementation Summaries',
  'Architecture & Scaling',
  'Session Notes',
  'Archive'
];

async function extractMetadata(filePath, relativePath = '') {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Extract title (first # heading)
    let title = null;
    let description = null;

    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].trim();

      // Get title from first # heading
      if (!title && line.startsWith('# ')) {
        title = line.replace(/^#\s+/, '').trim();
      }

      // Get description from first non-empty paragraph after title
      if (title && !description && line && !line.startsWith('#') && !line.startsWith('---')) {
        description = line.trim();
      }

      if (title && description) break;
    }

    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath, '.md');

    // Determine category from directory structure first, then fall back to filename
    let category = 'Other';
    const dirName = path.basename(path.dirname(filePath));

    if (DIRECTORY_CATEGORIES[dirName]) {
      category = DIRECTORY_CATEGORIES[dirName];
    } else if (CATEGORY_MAP[fileName]) {
      category = CATEGORY_MAP[fileName];
    }

    return {
      fileName,
      relativePath,
      title: title || fileName.replace(/_/g, ' '),
      description: description || 'Documentation file',
      lastModified: stats.mtime.toISOString(),
      size: stats.size,
      category
    };
  } catch (error) {
    console.error(`Error extracting metadata from ${filePath}:`, error);
    return null;
  }
}

async function scanDirectory(dirPath, basePath = '') {
  const files = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      // Skip archive directories unless explicitly needed
      if (entry.name === 'archive' || entry.name === '_archive') {
        continue;
      }
      // Recursively scan subdirectories
      const subFiles = await scanDirectory(fullPath, relativePath);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push({ fullPath, relativePath });
    }
  }

  return files;
}

async function generateDocsTree() {
  try {
    console.log('🔍 Scanning documentation directory recursively...');

    // Scan all markdown files recursively
    const fileEntries = await scanDirectory(DOCS_DIR);

    console.log(`📄 Found ${fileEntries.length} markdown files`);

    // Extract metadata from each file
    const docsPromises = fileEntries.map(({ fullPath, relativePath }) =>
      extractMetadata(fullPath, relativePath)
    );
    const docs = (await Promise.all(docsPromises)).filter(d => d !== null);

    // Group by category
    const categorized = {};
    docs.forEach(doc => {
      if (!categorized[doc.category]) {
        categorized[doc.category] = [];
      }
      categorized[doc.category].push(doc);
    });

    // Sort each category alphabetically by title
    Object.keys(categorized).forEach(category => {
      categorized[category].sort((a, b) => a.title.localeCompare(b.title));
    });

    // Create ordered structure
    const tree = {
      generated: new Date().toISOString(),
      totalFiles: docs.length,
      categories: CATEGORY_ORDER
        .filter(cat => categorized[cat])
        .map(category => ({
          name: category,
          count: categorized[category].length,
          docs: categorized[category]
        }))
    };

    // Add any uncategorized docs
    const uncategorizedKeys = Object.keys(categorized).filter(
      key => !CATEGORY_ORDER.includes(key)
    );

    if (uncategorizedKeys.length > 0) {
      uncategorizedKeys.forEach(category => {
        tree.categories.push({
          name: category,
          count: categorized[category].length,
          docs: categorized[category]
        });
      });
    }

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE);
    await fs.mkdir(outputDir, { recursive: true });

    // Write tree to file
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(tree, null, 2), 'utf-8');

    console.log('✅ Documentation tree generated successfully!');
    console.log(`📁 Output: ${OUTPUT_FILE}`);
    console.log(`📊 Total: ${tree.totalFiles} files in ${tree.categories.length} categories`);

    tree.categories.forEach(cat => {
      console.log(`   - ${cat.name}: ${cat.count} files`);
    });

    return tree;
  } catch (error) {
    console.error('❌ Error generating docs tree:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateDocsTree()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export default generateDocsTree;
