import express from 'express';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';

const router = express.Router();

/* ── Minimal Markdown → HTML ─────────────────────────────────────────────── */
function md(src) {
  // Normalize line endings
  let t = src.replace(/\r\n/g, '\n');

  // Fenced code blocks
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="lang-${lang || 'text'}">${esc.trimEnd()}</code></pre>`;
  });

  // Inline code (before other inline processing)
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Tables
  t = t.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm, (_, hdr, _sep, body) => {
    const ths = hdr.split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const tds = row.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Process block-level elements line by line
  const lines = t.split('\n');
  let html = '';
  let inList = false;
  let listType = '';
  let inP = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inP) { html += '</p>'; inP = false; }
      if (inList) { html += `</${listType}>`; inList = false; }
      const lvl = hMatch[1].length;
      html += `<h${lvl}>${inline(hMatch[2])}</h${lvl}>`;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inP) { html += '</p>'; inP = false; }
      if (inList) { html += `</${listType}>`; inList = false; }
      html += '<hr>';
      continue;
    }

    // Pre/code blocks (already processed above, pass through)
    if (line.startsWith('<pre>') || line.startsWith('<table>')) {
      if (inP) { html += '</p>'; inP = false; }
      if (inList) { html += `</${listType}>`; inList = false; }
      html += line;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (inP) { html += '</p>'; inP = false; }
      if (inList && listType !== 'ul') { html += `</${listType}>`; inList = false; }
      if (!inList) { html += '<ul>'; inList = true; listType = 'ul'; }
      html += `<li>${inline(ulMatch[1])}</li>`;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inP) { html += '</p>'; inP = false; }
      if (inList && listType !== 'ol') { html += `</${listType}>`; inList = false; }
      if (!inList) { html += '<ol>'; inList = true; listType = 'ol'; }
      html += `<li>${inline(olMatch[1])}</li>`;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      if (inP) { html += '</p>'; inP = false; }
      if (inList) { html += `</${listType}>`; inList = false; }
      continue;
    }

    // Paragraph
    if (!inP) { html += '<p>'; inP = true; }
    else { html += ' '; }
    html += inline(line);
  }

  if (inP) html += '</p>';
  if (inList) html += `</${listType}>`;

  return html;
}

/* ── Inline markdown ──────────────────────────────────────────────────────── */
function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      // Internal doc links → admin doc viewer
      if (href.match(/^\.{0,2}\//) && href.endsWith('.md')) {
        return `<a href="#" class="doc-link" data-slug="${slugFromPath(href)}">${text}</a>`;
      }
      return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    });
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function slugFromPath(p) {
  return p.replace(/^[./]+/, '').replace(/\.md$/, '').replace(/\//g, '--');
}

/* ── Build doc tree ──────────────────────────────────────────────────────── */
const DOCS_DIR = join(process.cwd(), 'docs');

// Categories in display order — only user-facing docs
const CATEGORIES = [
  { key: 'getting-started', label: 'Getting Started', files: ['platform/overview', 'platform/admin-panel'] },
  { key: 'platform',        label: 'Platform',        files: ['platform/settings', 'platform/advanced-settings', 'platform/ai-agents'] },
  { key: 'modules',         label: 'Modules',         files: [
    'modules/blog', 'modules/copy', 'modules/design', 'modules/portfolio',
    'modules/pages', 'modules/sections', 'modules/clients', 'modules/bookkeeping',
    'modules/email-marketing', 'modules/meetings', 'modules/assets', 'modules/users',
  ]},
];

async function loadDoc(relPath) {
  try {
    const raw = await readFile(join(DOCS_DIR, relPath + '.md'), 'utf8');
    // Extract title from first H1
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : relPath.split('/').pop();
    return { slug: slugFromPath(relPath), path: relPath, title, html: md(raw) };
  } catch { return null; }
}

async function loadAllDocs() {
  const docs = {};
  for (const cat of CATEGORIES) {
    for (const f of cat.files) {
      const doc = await loadDoc(f);
      if (doc) docs[doc.slug] = doc;
    }
  }
  return docs;
}

/* ── Routes ──────────────────────────────────────────────────────────────── */

// Main docs page
router.get('/', async (req, res) => {
  try {
    const docs = await loadAllDocs();
    res.render('admin/docs', {
      user: req.adminUser,
      page: 'docs',
      title: 'Documentation',
      categories: CATEGORIES,
      docs,
    });
  } catch (err) {
    console.error('[admin/docs] error:', err);
    res.render('admin/docs', {
      user: req.adminUser,
      page: 'docs',
      title: 'Documentation',
      categories: CATEGORIES,
      docs: {},
    });
  }
});

// API: fetch single doc as HTML (for SPA-style navigation)
router.get('/api/:slug', async (req, res) => {
  try {
    const docs = await loadAllDocs();
    const doc = docs[req.params.slug];
    if (!doc) return res.status(404).json({ error: 'Doc not found' });
    res.json({ title: doc.title, html: doc.html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
