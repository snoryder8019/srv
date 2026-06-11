/* ──────────────────────────────────────────────────────────────────
 * EMAIL-SAFE HTML
 *
 * Rich editors (Quill) and raw-HTML pastes produce markup that looks fine
 * in a browser but renders inconsistently — or not at all — across email
 * clients (Outlook, Gmail, Apple Mail). This module takes that markup and
 * returns "tighter", email-safe HTML:
 *   - drops dangerous / non-email tags (script, style, iframe, head, …)
 *   - unwraps unknown tags but keeps their text
 *   - strips classes / ids / event handlers
 *   - converts Quill alignment & indent classes to inline styles
 *   - injects inline styles on block elements so spacing survives the trip
 *
 * Input is admin-authored (trusted), so the priority is client compatibility
 * rather than untrusted-input XSS defense — but we still strip the obvious
 * script/handler vectors so a pasted snippet can't smuggle them through.
 * ────────────────────────────────────────────────────────────────── */

// Tags we keep. Everything else is unwrapped (tag removed, inner text kept),
// except the BLOCKED set below which is removed wholesale (content and all).
const ALLOWED = new Set([
  'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup', 'small',
  'a', 'img',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4',
  'blockquote', 'pre', 'code',
]);

// Tags whose entire subtree must go — they have no place in an email body.
const BLOCKED = ['script', 'style', 'head', 'meta', 'link', 'title', 'iframe',
  'object', 'embed', 'noscript', 'form', 'input', 'button', 'textarea', 'svg'];

// Per-tag inline styles, theme-agnostic so colors inherit from the email body
// container. `accent` (used by blockquote) is overridable by the caller.
function baseStyle(tag, accent) {
  switch (tag) {
    case 'p':          return 'margin:0 0 14px;';
    case 'div':        return 'margin:0 0 14px;';
    case 'h1':         return 'margin:0 0 12px;font-size:24px;font-weight:700;line-height:1.25;';
    case 'h2':         return 'margin:22px 0 10px;font-size:20px;font-weight:700;line-height:1.3;';
    case 'h3':         return 'margin:18px 0 8px;font-size:17px;font-weight:600;line-height:1.3;';
    case 'h4':         return 'margin:16px 0 6px;font-size:15px;font-weight:600;';
    case 'ul':
    case 'ol':         return 'margin:0 0 14px;padding-left:24px;';
    case 'li':         return 'margin:0 0 6px;';
    case 'blockquote': return `margin:0 0 14px;padding:6px 0 6px 16px;border-left:3px solid ${accent};font-style:italic;`;
    case 'pre':        return 'margin:0 0 14px;padding:12px 14px;background:#f4f4f4;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;';
    case 'code':       return 'font-family:Menlo,Consolas,monospace;font-size:0.92em;';
    case 'a':          return 'text-decoration:underline;';
    case 'img':        return 'max-width:100%;height:auto;border:0;display:block;margin:12px 0;border-radius:4px;';
    case 'hr':         return 'border:none;border-top:1px solid #E6E1D6;margin:18px 0;';
    default:           return '';
  }
}

// Attributes kept per tag (besides the synthesized `style`).
const KEEP_ATTRS = {
  a:   ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
};

// Style declarations we let through from the source markup (everything else is
// dropped in favor of our injected base styles). Values containing url(),
// expression, or javascript: are rejected.
const SAFE_STYLE_PROPS = new Set([
  'text-align', 'color', 'background-color', 'font-weight', 'font-style',
  'text-decoration', 'padding-left', 'width', 'max-width',
]);

function pickSafeStyles(styleStr) {
  if (!styleStr) return '';
  const out = [];
  for (const decl of styleStr.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    if (/url\s*\(|expression|javascript:/i.test(val)) continue;
    out.push(`${prop}:${val}`);
  }
  return out.join(';');
}

function getAttr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

// Translate Quill formatting classes into inline style fragments.
function quillClassStyles(classAttr) {
  if (!classAttr) return '';
  const out = [];
  const align = classAttr.match(/ql-align-(left|center|right|justify)/);
  if (align) out.push(`text-align:${align[1]}`);
  const indent = classAttr.match(/ql-indent-(\d+)/);
  if (indent) out.push(`padding-left:${Number(indent[1]) * 2}em`);
  return out.join(';');
}

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert arbitrary editor / pasted HTML into email-safe HTML.
 * @param {string} html
 * @param {object} [opts]
 * @param {string} [opts.accent='#C9A848'] - blockquote border color
 */
export function sanitizeEmailHtml(html, opts = {}) {
  if (!html || typeof html !== 'string') return '';
  const accent = opts.accent || '#C9A848';

  let s = html;

  // 1. Remove blocked subtrees wholesale (with content).
  for (const tag of BLOCKED) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    // Also kill an unclosed/self-closed leftover opening tag.
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '');
  }

  // 2. Drop HTML comments (incl. MSO conditionals — not for body copy).
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // 3. Rewrite every remaining tag.
  s = s.replace(/<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g, (full, slash, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) return ''; // unwrap unknown tag, keep inner text

    if (slash) return `</${tag}>`;

    // Build a clean attribute set.
    const styleParts = [];
    const base = baseStyle(tag, accent);
    if (base) styleParts.push(base);
    const cls = getAttr(attrs, 'class');
    const clsStyle = quillClassStyles(cls);
    if (clsStyle) styleParts.push(clsStyle);
    const picked = pickSafeStyles(getAttr(attrs, 'style'));
    if (picked) styleParts.push(picked);

    let rebuilt = `<${tag}`;
    for (const a of (KEEP_ATTRS[tag] || [])) {
      const v = getAttr(attrs, a);
      if (v == null) continue;
      if (a === 'href' || a === 'src') {
        // Block scriptable URL schemes.
        if (/^\s*(javascript|vbscript|data:text\/html)/i.test(v)) continue;
      }
      rebuilt += ` ${a}="${escAttr(v)}"`;
    }
    if (tag === 'a' && getAttr(attrs, 'target') === '_blank' && !/rel=/i.test(rebuilt)) {
      rebuilt += ' rel="noopener noreferrer"';
    }
    if (styleParts.length) rebuilt += ` style="${styleParts.join(';').replace(/;;+/g, ';')}"`;
    rebuilt += (tag === 'br' || tag === 'hr' || tag === 'img') ? '>' : '>';
    return rebuilt;
  });

  // 4. Collapse runs of empty paragraphs Quill leaves behind.
  s = s.replace(/(<p[^>]*>\s*(<br\s*\/?>)?\s*<\/p>\s*){2,}/gi, '<p style="margin:0 0 14px;">&nbsp;</p>');

  return s.trim();
}

export default sanitizeEmailHtml;
