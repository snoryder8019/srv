/* ───────────────────────────────────────────────────────────────────────────
   emailEditor.js — visual ("non-coder") editor for marketing email bodies.

   Campaign bodies are stored as the raw HTML that gets dropped into the
   branded campaign template. Editing that in a bare textarea means writing
   tags by hand — fine for a developer, hostile to everyone else. This turns
   any body <textarea> into a WYSIWYG page that LOOKS like the email (white
   600px column, brand fonts/colours) and writes email-safe HTML back into
   the textarea, which stays the real form field.

     SlabEmailEditor.attach('campBody', { onImage: openImagePicker });
     SlabEmailEditor.value('campBody');          // current HTML
     SlabEmailEditor.setValue('campBody', html); // load a draft / agent fill
     SlabEmailEditor.insert('campBody', '<img …>');

   Every helper degrades to plain textarea behaviour if no editor is attached,
   so callers never have to branch.

   The HTML that leaves here is deliberately conservative: inline styles only
   (no classes — mail clients strip stylesheets), <strong>/<em> instead of
   <b>/<i>, no scripts, no positioning. What the canvas shows is what the
   textarea holds is what the recipient gets.
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.SlabEmailEditor) return;

  var INSTANCES = {};

  // Never survives into an email body.
  var STRIP = { SCRIPT:1, STYLE:1, IFRAME:1, OBJECT:1, EMBED:1, FORM:1, INPUT:1,
                SELECT:1, TEXTAREA:1, BUTTON:1, META:1, LINK:1, NOSCRIPT:1,
                SVG:1, VIDEO:1, AUDIO:1, CANVAS:1, BASE:1 };

  // Carries no meaning in an email — drop the wrapper, keep the contents.
  var UNWRAP = { FONT:1, SECTION:1, ARTICLE:1, HEADER:1, FOOTER:1, MAIN:1,
                 ASIDE:1, NAV:1, LABEL:1, FIGURE:1, FIGCAPTION:1, ADDRESS:1 };

  // Editor-ese → email-ese.
  var RENAME = { B:'STRONG', I:'EM', STRIKE:'S', BIG:'STRONG', SMALL:'EM' };

  var ATTR_OK = { style:1, href:1, src:1, alt:1, title:1, target:1, rel:1,
                  width:1, height:1, align:1, valign:1, colspan:1, rowspan:1,
                  border:1, cellpadding:1, cellspacing:1, bgcolor:1, role:1 };

  // Default inline styling, applied per-property only where the element does
  // not already declare it — so anything the user (or the agent) styled by
  // hand survives a round-trip untouched.
  var DEFAULTS = {
    P:          { 'margin-top':'0', 'margin-bottom':'16px' },
    H1:         { 'margin-top':'0', 'margin-bottom':'14px', 'font-size':'26px', 'line-height':'1.25', 'font-weight':'600' },
    H2:         { 'margin-top':'0', 'margin-bottom':'12px', 'font-size':'21px', 'line-height':'1.3',  'font-weight':'600' },
    H3:         { 'margin-top':'0', 'margin-bottom':'10px', 'font-size':'17px', 'line-height':'1.35', 'font-weight':'600' },
    UL:         { 'margin-top':'0', 'margin-bottom':'16px', 'padding-left':'22px' },
    OL:         { 'margin-top':'0', 'margin-bottom':'16px', 'padding-left':'22px' },
    LI:         { 'margin-top':'0', 'margin-bottom':'6px' },
    BLOCKQUOTE: { 'margin-top':'0', 'margin-bottom':'16px', 'margin-left':'0', 'padding-left':'14px' },
    IMG:        { 'max-width':'100%', height:'auto', display:'block', 'margin-top':'16px', 'margin-bottom':'16px' },
    HR:         { border:'none', margin:'22px 0' },
  };

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v || '').trim() || fallback;
    } catch (e) { return fallback; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Block anything that can execute. Everything else (http, https, mailto, tel,
  // relative, {token} merge fields) is left exactly as typed.
  function safeUrl(raw) {
    var u = String(raw || '').trim();
    if (/^\s*(javascript|vbscript|data:text\/html)/i.test(u)) return '';
    return u;
  }

  // ── styles (injected once) ────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('seeStyles')) return;
    var st = document.createElement('style');
    st.id = 'seeStyles';
    st.textContent = [
      '.see-wrap{border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--surface);}',
      '.see-bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:7px 8px;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--navy) 4%,transparent);}',
      '.see-btn{font-family:"Jost",sans-serif;font-size:0.68rem;font-weight:500;letter-spacing:.03em;line-height:1;',
      'padding:6px 9px;border:1px solid var(--border);background:var(--surface);color:var(--slate);',
      'border-radius:2px;cursor:pointer;transition:all .12s;white-space:nowrap;}',
      '.see-btn:hover{border-color:var(--navy-mid);color:var(--navy);}',
      '.see-btn.on{background:var(--navy);border-color:var(--navy);color:var(--on-navy);}',
      '.see-btn b{font-weight:700;}.see-btn i{font-style:italic;}',
      '.see-sep{width:1px;height:18px;background:var(--border);margin:0 4px;flex-shrink:0;}',
      '.see-modes{margin-left:auto;display:flex;gap:4px;}',
      '.see-stage{background:#e9e6df;padding:16px;max-height:62vh;overflow-y:auto;}',
      '.see-canvas{background:#fff;max-width:600px;margin:0 auto;padding:26px 28px;min-height:230px;outline:none;',
      'font-family:var(--font-body),"Jost",Helvetica,Arial,sans-serif;font-size:15px;line-height:1.75;',
      'color:var(--navy-deep,#0F1B30);box-shadow:0 2px 16px rgba(0,0,0,.10);border-radius:2px;}',
      '.see-canvas.is-empty:before{content:attr(data-placeholder);color:#9aa2b1;font-style:italic;}',
      '.see-canvas:focus{box-shadow:0 2px 16px rgba(0,0,0,.10),0 0 0 2px var(--gold,#C9A848);}',
      '.see-canvas p{margin:0 0 16px;}',
      '.see-canvas h1{font-size:26px;line-height:1.25;margin:0 0 14px;font-weight:600;}',
      '.see-canvas h2{font-size:21px;line-height:1.3;margin:0 0 12px;font-weight:600;}',
      '.see-canvas h3{font-size:17px;line-height:1.35;margin:0 0 10px;font-weight:600;}',
      '.see-canvas ul,.see-canvas ol{margin:0 0 16px;padding-left:22px;}',
      '.see-canvas li{margin:0 0 6px;}',
      '.see-canvas img{max-width:100%;height:auto;}',
      '.see-canvas a{color:var(--navy);}',
      '.see-canvas table{max-width:100%;border-collapse:collapse;}',
      '.see-canvas hr{border:none;border-top:1px solid #E6E1D6;margin:22px 0;}',
      '.see-code{display:block;width:100%;border:0;border-radius:0;padding:14px 16px;min-height:300px;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.78rem;line-height:1.6;',
      'color:var(--on-surface);background:var(--surface);resize:vertical;outline:none;}',
      '.see-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:0.65rem;color:var(--slate);',
      'padding:6px 10px;border-top:1px solid var(--border);}',
      '.see-err{color:var(--danger,#B91C1C);font-weight:600;}',
      '@media (max-width:640px){.see-canvas{padding:18px 16px;}.see-stage{padding:10px;}}',
    ].join('');
    document.head.appendChild(st);
  }

  // ── HTML normaliser ───────────────────────────────────────────────────────
  function applyDefaults(el) {
    var d = DEFAULTS[el.nodeName];
    if (!d) return;
    for (var prop in d) {
      if (!Object.prototype.hasOwnProperty.call(d, prop)) continue;
      if (!el.style.getPropertyValue(prop)) {
        try { el.style.setProperty(prop, d[prop]); } catch (e) { /* bad value — skip */ }
      }
    }
  }

  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function rename(el, tag) {
    var next = el.ownerDocument.createElement(tag);
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      try { next.setAttribute(a.name, a.value); } catch (e) { /* ignore */ }
    }
    while (el.firstChild) next.appendChild(el.firstChild);
    el.parentNode.replaceChild(next, el);
    return next;
  }

  function cleanNode(node, opts) {
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.nodeType === 8) { node.removeChild(el); continue; }   // comment
      if (el.nodeType !== 1) continue;                             // text — keep

      if (STRIP[el.nodeName]) { node.removeChild(el); continue; }

      if (RENAME[el.nodeName]) el = rename(el, RENAME[el.nodeName]);

      // A DIV that only wraps inline content is a paragraph in disguise
      // (contenteditable emits these). One that holds real blocks is layout —
      // leave the structure alone.
      if (el.nodeName === 'DIV' && !el.querySelector('div,p,table,ul,ol,h1,h2,h3,blockquote')) {
        el = rename(el, 'P');
      }

      // A bare SPAN with nothing to say; keep styled ones, they carry emphasis.
      if (UNWRAP[el.nodeName] || (el.nodeName === 'SPAN' && !el.getAttribute('style'))) {
        cleanNode(el, opts);
        unwrap(el);
        continue;
      }

      // Attributes: whitelist, then scrub the survivors.
      var attrs = Array.prototype.slice.call(el.attributes);
      for (var j = 0; j < attrs.length; j++) {
        var name = attrs[j].name.toLowerCase();
        if (!ATTR_OK[name]) { el.removeAttribute(attrs[j].name); continue; }
        if (name === 'href' || name === 'src') {
          var clean = safeUrl(attrs[j].value);
          if (!clean) el.removeAttribute(attrs[j].name);
          else el.setAttribute(name, clean);
        }
      }

      if (el.nodeName === 'A') {
        // Buttons style themselves; plain links get the brand link treatment.
        var isButton = /background/i.test(el.getAttribute('style') || '');
        if (!isButton) {
          if (!el.style.getPropertyValue('color')) el.style.setProperty('color', opts.linkColor);
        }
        if (el.getAttribute('href') && !el.getAttribute('target')) el.setAttribute('target', '_blank');
      }

      applyDefaults(el);
      if (!el.getAttribute('style')) el.removeAttribute('style');
      cleanNode(el, opts);
    }
  }

  // Loose text at the top level is a paragraph waiting to happen.
  function wrapLooseText(root) {
    var kids = Array.prototype.slice.call(root.childNodes);
    var run = null;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      var loose = (n.nodeType === 3 && n.textContent.trim())
        || (n.nodeType === 1 && /^(STRONG|EM|A|S|U|CODE|IMG|SPAN|BR)$/.test(n.nodeName));
      if (!loose) { run = null; continue; }
      if (n.nodeType === 3 && !n.textContent.trim()) continue;
      if (!run) {
        run = root.ownerDocument.createElement('p');
        run.style.setProperty('margin-top', '0');
        run.style.setProperty('margin-bottom', '16px');
        root.insertBefore(run, n);
      }
      run.appendChild(n);
    }
  }

  // ── one editor ────────────────────────────────────────────────────────────
  function EmailEditor(textarea, opts) {
    this.ta = textarea;
    this.opts = opts || {};
    this.mode = 'visual';
    this.linkColor = cssVar('--navy', '#1C2B4A');
    this.btnBg = cssVar('--gold', '#C9A848');
    this.btnFg = cssVar('--on-gold', '#1C2B4A');
    this.build();
  }

  EmailEditor.prototype.build = function () {
    injectCss();
    var self = this;
    var ta = this.ta;

    // A `required` textarea that we hide would make the browser block submit on
    // an unfocusable field ("invalid form control is not focusable"). Take the
    // attribute over and validate it ourselves against the canvas.
    this.wasRequired = ta.hasAttribute('required');
    if (this.wasRequired) ta.removeAttribute('required');

    var wrap = document.createElement('div');
    wrap.className = 'see-wrap';
    ta.parentNode.insertBefore(wrap, ta);

    var bar = document.createElement('div');
    bar.className = 'see-bar';
    wrap.appendChild(bar);

    var stage = document.createElement('div');
    stage.className = 'see-stage';
    wrap.appendChild(stage);

    var canvas = document.createElement('div');
    canvas.className = 'see-canvas';
    canvas.setAttribute('contenteditable', 'true');
    canvas.setAttribute('spellcheck', 'true');
    canvas.setAttribute('data-placeholder', this.opts.placeholder
      || 'Write your email here. Use the toolbar for headings, links, images and buttons.');
    stage.appendChild(canvas);

    wrap.appendChild(ta);                 // the real form field, hidden in visual mode
    ta.classList.add('see-code');
    ta.style.display = 'none';

    var foot = document.createElement('div');
    foot.className = 'see-foot';
    foot.innerHTML = '<span id="' + ta.id + '_seeMsg"></span>'
      + '<span style="margin-left:auto;">Personalize with the {name} / {email} buttons — they fill in per recipient.</span>';
    wrap.appendChild(foot);

    this.wrap = wrap; this.canvas = canvas; this.bar = bar;
    this.msg = foot.firstChild;

    this.buildToolbar();

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* older browser */ }
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }

    canvas.innerHTML = ta.value || '';
    this.refreshEmpty();

    canvas.addEventListener('input', function () { self.onInput(); });
    canvas.addEventListener('blur', function () { self.sync(); });
    canvas.addEventListener('keyup', function () { self.refreshState(); });
    canvas.addEventListener('mouseup', function () { self.refreshState(); });

    // Paste: keep the words, drop the Word/Docs wrapper soup.
    canvas.addEventListener('paste', function (e) {
      var cb = e.clipboardData;
      if (!cb) return;
      var html = cb.getData('text/html');
      var text = cb.getData('text/plain');
      e.preventDefault();
      if (html) {
        var box = document.createElement('div');
        box.innerHTML = html;
        cleanNode(box, { linkColor: self.linkColor });
        wrapLooseText(box);
        document.execCommand('insertHTML', false, box.innerHTML);
      } else if (text) {
        var paras = text.split(/\n{2,}/).map(function (p) {
          return '<p style="margin-top:0;margin-bottom:16px;">' + esc(p).replace(/\n/g, '<br>') + '</p>';
        }).join('');
        document.execCommand('insertHTML', false, paras);
      }
      self.onInput();
    });

    // Clicking a link inside the canvas should edit it, not navigate.
    canvas.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (a) e.preventDefault();
    });

    // Keep the textarea authoritative at submit time, and stand in for the
    // `required` attribute we took off it.
    var form = ta.form;
    if (form) {
      form.addEventListener('submit', function (e) {
        if (self.mode === 'visual') self.sync();
        if (self.wasRequired && !self.ta.value.trim()) {
          e.preventDefault();
          self.setMode('visual');
          self.warn('Add some email content before saving.');
          self.canvas.focus();
        }
      });
      form.addEventListener('reset', function () {
        setTimeout(function () { self.setHTML(''); }, 0);
      });
    }
  };

  EmailEditor.prototype.buildToolbar = function () {
    var self = this;
    var groups = [
      [
        { label: 'Text',    title: 'Normal paragraph', run: function () { self.block('p'); } },
        { label: 'Heading', title: 'Section heading',  run: function () { self.block('h2'); } },
        { label: 'Small heading', title: 'Sub-heading', run: function () { self.block('h3'); } },
      ],
      [
        { label: '<b>B</b>', title: 'Bold (Ctrl+B)',   cmd: 'bold' },
        { label: '<i>I</i>', title: 'Italic (Ctrl+I)', cmd: 'italic' },
        { label: '• List',   title: 'Bullet list',     cmd: 'insertUnorderedList' },
        { label: '1. List',  title: 'Numbered list',   cmd: 'insertOrderedList' },
      ],
      [
        { label: 'Link',    title: 'Add or edit a link', run: function () { self.link(); } },
        { label: 'Button',  title: 'Insert a call-to-action button', run: function () { self.ctaButton(); } },
        { label: 'Image',   title: 'Insert an image',    run: function () { self.image(); } },
        { label: 'Divider', title: 'Insert a divider line', run: function () { self.insertHTML('<hr style="border:none;border-top:1px solid #E6E1D6;margin:22px 0;">'); } },
      ],
      [
        { label: '{name}',  title: "Insert the recipient's name",  run: function () { self.insertHTML('{name}'); } },
        { label: '{email}', title: "Insert the recipient's email", run: function () { self.insertHTML('{email}'); } },
        { label: 'Clear',   title: 'Strip formatting from the selection', cmd: 'removeFormat' },
      ],
    ];

    for (var g = 0; g < groups.length; g++) {
      if (g) this.bar.appendChild(mk('div', 'see-sep'));
      for (var i = 0; i < groups[g].length; i++) this.bar.appendChild(this.mkBtn(groups[g][i]));
    }

    var modes = mk('div', 'see-modes');
    this.visualBtn = this.mkBtn({ label: 'Visual', title: 'Visual editor', run: function () { self.setMode('visual'); } });
    this.htmlBtn = this.mkBtn({ label: '&lt;/&gt; HTML', title: 'Edit the raw HTML', run: function () { self.setMode('html'); } });
    this.visualBtn.classList.add('on');
    modes.appendChild(this.visualBtn);
    modes.appendChild(this.htmlBtn);
    this.bar.appendChild(modes);

    function mk(tag, cls) { var el = document.createElement(tag); el.className = cls; return el; }
  };

  EmailEditor.prototype.mkBtn = function (spec) {
    var self = this;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'see-btn';
    b.innerHTML = spec.label;
    if (spec.title) b.title = spec.title;
    if (spec.cmd) b.setAttribute('data-cmd', spec.cmd);
    // mousedown would move focus out of the canvas and kill the selection.
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () {
      if (self.mode !== 'visual') return;
      if (spec.cmd) self.exec(spec.cmd);
      else spec.run();
    });
    return b;
  };

  // ── commands ──────────────────────────────────────────────────────────────
  EmailEditor.prototype.focusCanvas = function () {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !this.canvas.contains(sel.anchorNode)) {
      this.canvas.focus();
      var r = document.createRange();
      r.selectNodeContents(this.canvas);
      r.collapse(false);
      sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      this.canvas.focus();
    }
  };

  EmailEditor.prototype.exec = function (cmd, val) {
    this.focusCanvas();
    try { document.execCommand(cmd, false, val == null ? null : val); } catch (e) { /* ignore */ }
    this.onInput();
    this.refreshState();
  };

  EmailEditor.prototype.block = function (tag) { this.exec('formatBlock', '<' + tag + '>'); };

  EmailEditor.prototype.insertHTML = function (html) {
    this.focusCanvas();
    try { document.execCommand('insertHTML', false, html); }
    catch (e) { this.canvas.insertAdjacentHTML('beforeend', html); }
    this.onInput();
  };

  EmailEditor.prototype.currentLink = function () {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var n = sel.anchorNode;
    while (n && n !== this.canvas) {
      if (n.nodeType === 1 && n.nodeName === 'A') return n;
      n = n.parentNode;
    }
    return null;
  };

  EmailEditor.prototype.link = function () {
    var existing = this.currentLink();
    var url = window.prompt('Link address', existing ? existing.getAttribute('href') : 'https://');
    if (url === null) return;
    url = safeUrl(url);
    if (!url) { this.exec('unlink'); return; }
    if (existing) { existing.setAttribute('href', url); existing.setAttribute('target', '_blank'); this.onInput(); return; }
    var sel = window.getSelection();
    var hasText = sel && sel.rangeCount && String(sel).trim();
    if (hasText) { this.exec('createLink', url); return; }
    var label = window.prompt('Text to show for the link', url);
    if (label === null) return;
    this.insertHTML('<a href="' + esc(url) + '" target="_blank" style="color:' + this.linkColor + ';">' + esc(label || url) + '</a>');
  };

  EmailEditor.prototype.ctaButton = function () {
    var label = window.prompt('Button text', 'Learn more');
    if (label === null) return;
    var url = window.prompt('Where should the button go?', 'https://');
    if (url === null) return;
    url = safeUrl(url) || '#';
    this.insertHTML(
      '<p style="margin-top:0;margin-bottom:16px;text-align:center;">'
      + '<a href="' + esc(url) + '" target="_blank" style="display:inline-block;padding:13px 30px;'
      + 'background:' + this.btnBg + ';color:' + this.btnFg + ';text-decoration:none;font-weight:600;'
      + 'border-radius:3px;">' + esc(label || 'Learn more') + '</a></p>'
    );
  };

  EmailEditor.prototype.image = function () {
    if (typeof this.opts.onImage === 'function') { this.opts.onImage(this); return; }
    var url = window.prompt('Image URL', 'https://');
    if (!url) return;
    this.insertHTML('<img src="' + esc(safeUrl(url)) + '" alt="" style="max-width:100%;height:auto;display:block;margin:16px 0;">');
  };

  // Light active-state feedback so the toolbar reflects the caret.
  EmailEditor.prototype.refreshState = function () {
    var btns = this.bar.querySelectorAll('.see-btn[data-cmd]');
    for (var i = 0; i < btns.length; i++) {
      var cmd = btns[i].getAttribute('data-cmd');
      var on = false;
      try { on = document.queryCommandState(cmd); } catch (e) { on = false; }
      btns[i].classList.toggle('on', !!on);
    }
  };

  EmailEditor.prototype.refreshEmpty = function () {
    var empty = !this.canvas.textContent.trim() && !this.canvas.querySelector('img,hr,table');
    this.canvas.classList.toggle('is-empty', empty);
  };

  EmailEditor.prototype.warn = function (text) {
    this.msg.className = 'see-err';
    this.msg.textContent = text || '';
    var self = this;
    clearTimeout(this._warnT);
    this._warnT = setTimeout(function () { self.msg.textContent = ''; }, 5000);
  };

  // ── value plumbing ────────────────────────────────────────────────────────
  EmailEditor.prototype.serialize = function () {
    var box = document.createElement('div');
    box.innerHTML = this.canvas.innerHTML;
    cleanNode(box, { linkColor: this.linkColor });
    wrapLooseText(box);
    // Readable source: one top-level block per line.
    var out = [];
    for (var i = 0; i < box.childNodes.length; i++) {
      var n = box.childNodes[i];
      if (n.nodeType === 1) out.push(n.outerHTML);
      else if (n.nodeType === 3 && n.textContent.trim()) out.push(n.textContent.trim());
    }
    var html = out.join('\n');
    // An empty canvas is empty content, not "<p><br></p>".
    if (!/<(img|hr|table)/i.test(html) && !box.textContent.trim()) return '';
    return html;
  };

  EmailEditor.prototype.onInput = function () {
    this.refreshEmpty();
    var self = this;
    clearTimeout(this._syncT);
    this._syncT = setTimeout(function () { self.sync(); }, 250);
  };

  /** Push the canvas into the textarea (the real form field). */
  EmailEditor.prototype.sync = function () {
    if (this.mode !== 'visual') return;
    clearTimeout(this._syncT);
    this.ta.value = this.serialize();
  };

  EmailEditor.prototype.getHTML = function () {
    if (this.mode === 'visual') this.sync();
    return this.ta.value;
  };

  EmailEditor.prototype.setHTML = function (html) {
    this.ta.value = html || '';
    this.canvas.innerHTML = html || '';
    this.refreshEmpty();
    if (this.mode === 'visual') this.sync();
  };

  EmailEditor.prototype.flash = function () {
    var el = this.mode === 'visual' ? this.canvas : this.ta;
    el.classList.add('ai-filled');
  };

  EmailEditor.prototype.setMode = function (mode) {
    if (mode === this.mode) return;
    if (mode === 'html') {
      this.sync();
      this.ta.style.display = '';
      this.wrap.querySelector('.see-stage').style.display = 'none';
    } else {
      this.canvas.innerHTML = this.ta.value || '';
      this.ta.style.display = 'none';
      this.wrap.querySelector('.see-stage').style.display = '';
      this.refreshEmpty();
    }
    this.mode = mode;
    this.visualBtn.classList.toggle('on', mode === 'visual');
    this.htmlBtn.classList.toggle('on', mode === 'html');
    if (mode === 'visual') this.sync();
  };

  // ── public API ────────────────────────────────────────────────────────────
  function resolve(idOrEl) {
    return typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  }

  window.SlabEmailEditor = {
    attach: function (idOrEl, opts) {
      var ta = resolve(idOrEl);
      if (!ta || ta.nodeName !== 'TEXTAREA') return null;
      if (INSTANCES[ta.id]) return INSTANCES[ta.id];
      var ed = new EmailEditor(ta, opts);
      if (ta.id) INSTANCES[ta.id] = ed;
      return ed;
    },
    get: function (id) { return INSTANCES[id] || null; },

    // The three helpers below work with or without an attached editor, so page
    // code (agent fills, draft loading, image picker) never has to branch.
    value: function (id) {
      var ed = INSTANCES[id];
      if (ed) return ed.getHTML();
      var ta = resolve(id);
      return ta ? ta.value : '';
    },
    setValue: function (id, html, opts) {
      var ed = INSTANCES[id];
      if (ed) { ed.setHTML(html); if (opts && opts.flash) ed.flash(); return; }
      var ta = resolve(id);
      if (ta) { ta.value = html || ''; if (opts && opts.flash) ta.classList.add('ai-filled'); }
    },
    insert: function (id, html) {
      var ed = INSTANCES[id];
      if (ed) { ed.insertHTML(html); return; }
      var ta = resolve(id);
      if (!ta) return;
      var s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + html + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + html.length;
      ta.focus();
    },
  };
})();
