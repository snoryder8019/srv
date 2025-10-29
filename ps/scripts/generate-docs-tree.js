import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate Documentation Tree
 *
 * This script scans the zMDREADME directory and generates a structured
 * documentation tree with categories, files, and metadata.
 */

const DOCS_DIR = path.join(__dirname, '../zMDREADME');
const OUTPUT_FILE = path.join(__dirname, '../public/data/docs-tree.json');

// Category mappings based on file patterns
const CATEGORY_MAP = {
  'PROJECT_OVERVIEW': 'Getting Started',
  'TESTER_QUICK_REFERENCE': 'Quick References',
  'TESTER_SYSTEM_COMPLETE': 'Systems & Features',
  'ASSET_BUILDER_COMPLETE': 'Systems & Features',
  'GALACTIC_MAP_COMPLETE': 'Systems & Features',
  'LOCATION_SYSTEM_IMPLEMENTATION': 'Systems & Features',
  'ANALYTICS_SYSTEM': 'Systems & Features',
  'USER_CHARACTER_REFERENCE': 'Quick References',
  'MENU_SYSTEM': 'Quick References',
  'STATUS_BAR_README': 'Quick References',
  'DOCUMENTATION_CLEANUP_SUMMARY': 'Meta',
  'DOCUMENTATION_SYSTEM': 'Systems & Features',
  'README': 'Getting Started'
};

// Priority order for display
const CATEGORY_ORDER = [
  'Getting Started',
  'Quick References',
  'Systems & Features',
  'Meta'
];

async function extractMetadata(filePath) {
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

    return {
      fileName,
      title: title || fileName.replace(/_/g, ' '),
      description: description || 'Documentation file',
      lastModified: stats.mtime.toISOString(),
      size: stats.size,
      category: CATEGORY_MAP[fileName] || 'Other'
    };
  } catch (error) {
    console.error(`Error extracting metadata from ${filePath}:`, error);
    return null;
  }
}

async function generateDocsTree() {
  try {
    console.log('🔍 Scanning documentation directory...');

    // Read all markdown files
    const files = await fs.readdir(DOCS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    console.log(`📄 Found ${mdFiles.length} markdown files`);

    // Extract metadata from each file
    const docsPromises = mdFiles.map(file =>
      extractMetadata(path.join(DOCS_DIR, file))
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
