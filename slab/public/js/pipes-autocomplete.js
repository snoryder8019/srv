/**
 * Slab — {{ }} pipe autocomplete
 * Attaches to any <textarea>/<input type=text> inside a [data-pipes] container.
 * Works with statically- AND dynamically-rendered fields (document delegation).
 * Catalog comes from GET /admin/pipes/catalog. See plugins/pipes.js for the engine.
 */
(function () {
  var catalog = null, loading = null;
  var box = null, activeField = null, items = [], sel = 0, triggerStart = -1;

  // ── styles (injected once) ──
  var css = ''
    + '.pipe-ac{position:absolute;z-index:99999;display:none;max-height:300px;overflow-y:auto;'
    + 'background:#fff;border:1px solid #d4d4d8;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.18);'
    + 'font-family:system-ui,sans-serif;min-width:240px;max-width:440px;padding:4px;}'
    + '.pipe-ac-grp{font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;padding:6px 10px 2px;font-weight:700;}'
    + '.pipe-ac-item{padding:6px 10px;border-radius:5px;cursor:pointer;display:flex;flex-direction:column;gap:1px;}'
    + '.pipe-ac-item.sel{background:#1C2B4A;}'
    + '.pipe-ac-item.sel .pi-tok,.pipe-ac-item.sel .pi-det{color:#fff;}'
    + '.pi-tok{font-family:ui-monospace,Menlo,monospace;font-size:.82rem;color:#1C2B4A;}'
    + '.pi-det{font-size:.7rem;color:#6b7280;}'
    + '.pipe-ac-empty{padding:10px 12px;font-size:.78rem;color:#9ca3af;}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    if (loading) return loading;
    loading = fetch('/admin/pipes/catalog', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { catalog = (d && d.tokens) || []; return catalog; })
      .catch(function () { catalog = []; return catalog; });
    return loading;
  }

  function eligible(el) {
    if (!el) return false;
    var ok = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el.type === 'text' || el.type === ''));
    return ok && !!el.closest('[data-pipes]');
  }

  // Find an open, unclosed "{{" before the caret; return its index + the typed query.
  function findTrigger(el) {
    var v = el.value, c = el.selectionStart;
    var open = v.lastIndexOf('{{', c - 1);
    if (open < 0) return null;
    var close = v.indexOf('}}', open);
    if (close >= 0 && close < c) return null;          // already closed before caret
    var q = v.slice(open + 2, c);
    if (/[}\n]/.test(q)) return null;                  // } or newline ends the token
    return { open: open, query: q.trim() };
  }

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'pipe-ac';
    box.addEventListener('mousedown', function (e) {
      var it = e.target.closest('.pipe-ac-item');
      if (it) { e.preventDefault(); accept(parseInt(it.dataset.i, 10)); }
    });
    document.body.appendChild(box);
    return box;
  }

  function positionBox(el) {
    var r = el.getBoundingClientRect();
    box.style.left = (window.scrollX + r.left) + 'px';
    box.style.top = (window.scrollY + r.bottom + 4) + 'px';
    box.style.minWidth = Math.min(Math.max(r.width, 240), 440) + 'px';
  }

  function filter(q) {
    q = (q || '').toLowerCase();
    return catalog.filter(function (t) {
      if (!q) return true;
      return (t.insert + ' ' + (t.label || '') + ' ' + (t.detail || '') + ' ' + (t.group || '')).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 14);
  }

  function render() {
    if (!items.length) { box.innerHTML = '<div class="pipe-ac-empty">No matching pipes</div>'; return; }
    var html = '', lastGrp = null;
    items.forEach(function (t, i) {
      if (t.group !== lastGrp) { html += '<div class="pipe-ac-grp">' + esc(t.group || '') + '</div>'; lastGrp = t.group; }
      html += '<div class="pipe-ac-item' + (i === sel ? ' sel' : '') + '" data-i="' + i + '">'
        + '<span class="pi-tok">{{' + esc(t.label || t.insert) + '}}</span>'
        + (t.detail ? '<span class="pi-det">' + esc(t.detail) + '</span>' : '')
        + '</div>';
    });
    box.innerHTML = html;
    var selEl = box.querySelector('.pipe-ac-item.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  function openFor(el) {
    var trig = findTrigger(el);
    if (!trig) { close(); return; }
    activeField = el; triggerStart = trig.open;
    loadCatalog().then(function () {
      if (activeField !== el) return;
      items = filter(trig.query); sel = 0;
      ensureBox(); render(); positionBox(el);
      box.style.display = 'block';
    });
  }

  function accept(i) {
    var t = items[i]; if (!t || !activeField) return;
    var el = activeField, v = el.value, c = el.selectionStart;
    var before = v.slice(0, triggerStart), after = v.slice(c);
    var token = '{{' + t.insert + '}}';
    el.value = before + token + after;
    var pos = before.length + token.length;
    el.selectionStart = el.selectionEnd = pos;
    close();
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true })); // notify host listeners (autosize, dirty-state)
  }

  function close() { if (box) box.style.display = 'none'; activeField = null; triggerStart = -1; }
  function isOpen() { return box && box.style.display === 'block' && activeField; }

  document.addEventListener('input', function (e) { if (eligible(e.target)) openFor(e.target); }, true);

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { if (items.length) { e.preventDefault(); accept(sel); } }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }, true);

  document.addEventListener('click', function (e) {
    if (box && !box.contains(e.target) && e.target !== activeField) close();
  });
  // reposition while scrolling a long editor
  window.addEventListener('scroll', function () { if (isOpen()) positionBox(activeField); }, true);
})();
