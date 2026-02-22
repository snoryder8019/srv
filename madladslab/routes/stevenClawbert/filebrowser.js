import express from 'express';
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';

const router = express.Router();
const ROOT = '/srv';
const SKIP = new Set(['node_modules', '.git', '.npm', '.cache', '.yarn', 'dist', '.next', '__pycache__']);

function isAdmin(req, res, next) {
  if (req.user && req.user.isAdmin === true) return next();
  if (req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return res.status(401).send('Unauthorized');
}

function safePath(p) {
  if (!p) return null;
  const normalized = path.normalize(p);
  if (normalized !== ROOT && !normalized.startsWith(ROOT + '/')) return null;
  return path.resolve(normalized);
}

router.get('/', isAdmin, (req, res) => {
  res.render('stevenClawbert/filebrowser', {
    title: 'SRV Node Browser',
    user: req.user
  });
});

router.get('/api/ls', isAdmin, (req, res) => {
  const p = safePath(req.query.path || ROOT);
  if (!p) return res.status(400).json({ success: false, error: 'Invalid path' });

  try {
    const entries = fs.readdirSync(p, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
      .map(e => {
        const full = path.join(p, e.name);
        let size = 0, childCount = 0;
        try {
          const st = fs.statSync(full);
          size = st.size;
          if (e.isDirectory()) {
            try {
              childCount = fs.readdirSync(full)
                .filter(n => !n.startsWith('.') && !SKIP.has(n)).length;
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
        return {
          name: e.name,
          path: full,
          isDir: e.isDirectory(),
          size,
          childCount,
          ext: e.isFile() ? path.extname(e.name).toLowerCase() : null
        };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ success: true, path: p, items: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Render an EJS template server-side and return the HTML
// Works for any .ejs or .js file under /srv — resolves relative includes automatically
router.get('/api/render', isAdmin, async (req, res) => {
  const p = safePath(req.query.path);
  if (!p) return res.status(400).send('Invalid path');

  const ext = path.extname(p).toLowerCase();
  const origin = `${req.protocol}://${req.get('host')}`;
  const baseTag = `<base href="${origin}/">`;

  // Inject <base> tag to ensure CSS/images/scripts resolve from the app origin
  function injectBase(html) {
    if (html.includes('<head>')) return html.replace('<head>', `<head>${baseTag}`);
    if (html.includes('<HEAD>')) return html.replace('<HEAD>', `<HEAD>${baseTag}`);
    return `${baseTag}${html}`;
  }

  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return res.status(400).send('Not a file');

    // Serve vanilla JS files as a highlighted source view
    if (ext === '.js') {
      const src = fs.readFileSync(p, 'utf8');
      const escaped = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<!DOCTYPE html><html><head>${baseTag}
<meta charset="utf-8">
<title>${path.basename(p)}</title>
<link rel="stylesheet" href="/stylesheets/style.css">
<style>
  body { background:#0a0a0a; color:#ccc; margin:0; padding:1rem; font-family:monospace; }
  pre { white-space:pre-wrap; word-break:break-word; font-size:13px; line-height:1.6; }
  .kw  { color:#ff79c6; }
  .str { color:#f1fa8c; }
  .cmt { color:#6272a4; font-style:italic; }
  .fn  { color:#50fa7b; }
  .num { color:#bd93f9; }
</style></head><body>
<pre>${escaped}</pre>
<script>
// Basic syntax highlight pass
const pre = document.querySelector('pre');
pre.innerHTML = pre.innerHTML
  .replace(/(\/\/[^\\n]*)/g, '<span class="cmt">$1</span>')
  .replace(/\\b(const|let|var|function|return|import|export|default|from|if|else|for|while|class|new|this|async|await|try|catch|throw|typeof|instanceof)\\b/g, '<span class="kw">$1</span>')
  .replace(/("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|&#96;(?:[^&#96;\\\\]|\\\\.)*&#96;)/g, '<span class="str">$1</span>')
  .replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span class="num">$1</span>');
</script>
</body></html>`;
      res.set('Content-Type', 'text/html');
      return res.send(html);
    }

    if (ext !== '.ejs') return res.status(400).send('Unsupported file type for render');

    // Find the views root for this file so relative includes resolve
    const viewsIdx = p.indexOf('/views/');
    const viewsRoot = viewsIdx !== -1 ? p.slice(0, viewsIdx + 7) : path.dirname(p);

    const html = await ejs.renderFile(p, {
      user: req.user,
      title: path.basename(p, '.ejs'),
    }, {
      root: viewsRoot,
      views: [viewsRoot],
    });

    res.set('Content-Type', 'text/html');
    res.send(injectBase(html));
  } catch (err) {
    res.status(500).send(`<!DOCTYPE html><html><head>${baseTag}</head><body style="background:#0a0a0a;color:#ff6666;font-family:monospace;padding:2rem">
      <h3>Render error</h3><pre>${err.message}</pre></body></html>`);
  }
});

router.get('/api/read', isAdmin, (req, res) => {
  const p = safePath(req.query.path);
  if (!p) return res.status(400).json({ success: false, error: 'Invalid path' });

  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return res.status(400).json({ success: false, error: 'Not a file' });
    if (st.size > 512 * 1024) {
      return res.json({ success: true, content: `[File too large to display: ${(st.size / 1024).toFixed(0)} KB]`, truncated: true });
    }
    const content = fs.readFileSync(p, 'utf8');
    res.json({ success: true, content, size: st.size });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
