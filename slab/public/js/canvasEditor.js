/* ============================================================================
 * Slab Canvas Editor — in-preview direct-manipulation editing.
 *
 * Runs entirely in the /admin/design panel window and decorates the SAME-ORIGIN
 * preview iframe's DOM. No server render of "edit mode", no per-keystroke server
 * calls — the compute lives in the browser and saves are batched on commit, so
 * the server never gets hammered.
 *
 * It binds by INVERTING the panel's existing selector maps (window.SlabPreviewMaps
 * = { copyMap, visMap, dynamicCopySelector }), which already encode
 * "data key -> DOM selector". That's the whole trick that avoids sprinkling
 * data-* metadata through the public templates.
 *
 * Phases implemented (default-layout model):
 *   P1  selection loop  — hover highlight, click -> open matching left accordion
 *   P2  inline text     — contentEditable on text fields -> batched /copy-key save
 *   P3  inline image    — click an image -> asset picker -> swap + save
 *   P4  repeater dup     — "+" on service/process/stat groups clones the last item
 *   P5  insert section   — hover "+" between custom sections -> options -> insert
 *
 * The activated-template (block) model is handled by the panel's normal template
 * builder for now; see TODO(block-model) below.
 * ==========================================================================*/
(function () {
  'use strict';

  var W = window;   // window alias used throughout (SlabCanvas API, maps, stubs)

  var S = {
    on: false,
    frame: null,
    doc: null,
    win: null,
    maps: null,
    bindings: [],        // [{node, key, prop, editable}]
    selected: null,
    queue: {},           // copyKey -> value (batched saves)
    timer: null,
    hovered: null,
  };

  // ---- small helpers ------------------------------------------------------
  function panelInput(key) { return document.querySelector('[name="' + key + '"]'); }
  function status(msg, tone) {
    var el = document.getElementById('canvasStatus');
    if (el) { el.textContent = msg; el.style.color = tone === 'save' ? 'var(--gold)' : (tone === 'ok' ? '#15803D' : 'var(--slate)'); }
  }
  function friendly(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function safeAll(doc, sel) {
    try { return Array.prototype.slice.call(doc.querySelectorAll(sel)); } catch (e) { return []; }
  }
  // Inline-editable props. 'childText'/'heroHeading'/'headingBrEm' are em-paired
  // headings (a separate *_em copy key holds the emphasized span), so editing
  // them as raw innerHTML would double-store markup — those stay select-only
  // (click opens the panel field). Plain text + standalone innerHTML are safe.
  var TEXT_PROPS = { textContent: 1, innerHTML: 1 };
  var USE_INNERHTML = { innerHTML: 1 };

  // Section types offered in the drag rail / insert modal. Override from the
  // panel via window.SLAB_SECTION_TYPES = [[type,label],…].
  var SECTION_TYPES = W.SLAB_SECTION_TYPES || [
    ['text', 'Text'], ['split', 'Split'], ['cta', 'CTA Banner'],
    ['cards', 'Cards'], ['faq', 'FAQ'], ['writer_feed', 'Writer Feed'],
  ];

  // P6 block model: template-live.ejs marks each block <section> with
  // data-slab-block (id) + data-slab-type. These per-type maps resolve the
  // single-value editable text fields within a block. (Repeater-item blocks —
  // faq/pricing/testimonials/stats cards — are a follow-up.)
  var BLOCK_FIELDS = {
    hero:  { heading: '.lb-heading', subheading: '.lb-body', cta_text: '.lb-btn' },
    text:  { subheading: '.lb-eyebrow', heading: '.lb-heading', body: '.lb-body' },
    split: { heading: '.lb-heading', body: '.lb-body', cta_text: '.lb-btn' },
    cta:   { heading: '.lb-heading', subtext: '.lb-body', btn_text: '.lb-btn' },
    cards: { heading: '.lb-cards-intro .lb-heading', subtext: '.lb-cards-intro .lb-body' },
  };

  // ---- styles injected INTO the iframe document ---------------------------
  var EDIT_CSS = [
    '.slab-ce-editable{cursor:text;transition:outline .08s;}',
    '.slab-ce-editable[data-slab-img="1"]{cursor:pointer;}',
    '.slab-ce-hover{outline:2px dashed rgba(201,168,72,.9)!important;outline-offset:2px;position:relative;}',
    '.slab-ce-hover::before{content:attr(data-slab-label);position:absolute;top:-18px;left:0;z-index:2147483000;background:#1C2B4A;color:#E8D08A;font:600 10px/1.4 system-ui,sans-serif;letter-spacing:.04em;padding:1px 6px;border-radius:3px 3px 3px 0;white-space:nowrap;pointer-events:none;text-transform:uppercase;}',
    '.slab-ce-selected{outline:2px solid rgba(201,168,72,1)!important;outline-offset:2px;}',
    '.slab-ce-editing{outline:2px solid #15803D!important;outline-offset:2px;background:rgba(21,128,61,.04);}',
    '.slab-ce-rep{position:relative;}',
    '.slab-ce-repbtn{position:absolute;bottom:6px;right:6px;z-index:2147483000;background:#C9A848;color:#0F1B30;border:none;border-radius:100px;width:26px;height:26px;font:700 16px/1 system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:0;transition:opacity .1s;}',
    '.slab-ce-rep:hover .slab-ce-repbtn{opacity:1;}',
    // Insertion strip: thin until hovered, then a 35px dashed band with a "+".
    // Expands instantly on hover; lingers 2.2s then animates away on hover-off
    // (transition-delay applies to the leaving state only — hover overrides to 0s).
    '.slab-ce-ins{position:relative;height:8px;margin:-4px 0;z-index:2147483200;transition:height .3s ease 2.2s;}',
    '.slab-ce-ins:hover{height:35px;transition:height .12s ease 0s;}',
    '.slab-ce-ins::before{content:"";position:absolute;inset:3px 10px;border:2px dashed rgba(201,168,72,.95);border-radius:5px;background:rgba(201,168,72,.06);pointer-events:none;opacity:0;transition:opacity .3s ease 2.2s;}',
    '.slab-ce-ins:hover::before{opacity:1;transition:opacity .12s ease 0s;}',
    '.slab-ce-ins-plus{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:100px;background:#1C2B4A;color:#E8D08A;border:2px solid #C9A848;font:700 18px/1 system-ui;cursor:pointer;opacity:0;transition:opacity .3s ease 2.2s;display:flex;align-items:center;justify-content:center;padding:0;}',
    '.slab-ce-ins:hover .slab-ce-ins-plus{opacity:1;transition:opacity .12s ease 0s;}',
    '.slab-ce-ins-open{height:auto!important;min-height:44px;overflow:visible;transition:none;}',
    '.slab-ce-ins-open::before{opacity:1!important;transition:none;}',
    '.slab-ce-ins-open .slab-ce-ins-plus{opacity:1;}',
    '.slab-ce-ins-menu{position:absolute;left:50%;top:6px;transform:translateX(-50%);background:#1C2B4A;border:1px solid #C9A848;border-radius:7px;padding:5px;display:flex;flex-direction:column;gap:2px;box-shadow:0 10px 30px rgba(0,0,0,.4);min-width:170px;}',
    '.slab-ce-ins-item{background:none;border:none;color:#E8D08A;font:600 12px system-ui;text-align:left;padding:8px 13px;border-radius:5px;cursor:pointer;white-space:nowrap;}',
    '.slab-ce-ins-item:hover{background:rgba(201,168,72,.22);color:#FDFCFA;}',
    '.slab-ce-off *{cursor:auto;}',
  ].join('');

  function injectStyles() {
    if (!S.doc || S.doc.getElementById('slab-ce-style')) return;
    var st = S.doc.createElement('style');
    st.id = 'slab-ce-style';
    st.textContent = EDIT_CSS;
    (S.doc.head || S.doc.documentElement).appendChild(st);
  }

  // ---- build the DOM<->data binding index from the maps -------------------
  function bind(node, key, prop) {
    if (!node || node.__slabKey) return;                 // one binding per node
    node.__slabKey = key;
    node.__slabProp = prop;
    node.__slabEditable = !!TEXT_PROPS[prop];
    node.classList.add('slab-ce-editable');
    node.setAttribute('data-slab-label', friendly(key));
    S.bindings.push({ node: node, key: key, prop: prop, editable: node.__slabEditable });
  }

  function buildIndex() {
    S.bindings = [];
    if (!S.doc || !S.maps) return;
    var cm = S.maps.copyMap || {};
    Object.keys(cm).forEach(function (key) {
      var m = cm[key];
      if (!m || !m.sel) return;
      var nodes = safeAll(S.doc, m.sel);
      if (!nodes.length) return;
      // nth-child selectors resolve to a single node; multi-match (rare) -> first.
      bind(nodes[0], key, m.prop);
    });
    buildBlockIndex();
    tagImages();
    tagRepeaters();
    tagInserts();
  }

  // Bind block fields on a template-rendered page (data-slab-block sections).
  function bindBlock(node, blockId, field) {
    if (!node || node.__slabKey || node.__slabBlock) return;
    node.__slabBlock = blockId;
    node.__slabField = field;
    node.__slabEditable = true;
    node.classList.add('slab-ce-editable');
    node.setAttribute('data-slab-label', friendly(field));
    S.bindings.push({ node: node, block: blockId, field: field, editable: true });
  }
  function buildBlockIndex() {
    safeAll(S.doc, '[data-slab-block]').forEach(function (sec) {
      var blockId = sec.getAttribute('data-slab-block');
      // Preferred, skin-agnostic path: any descendant tagged data-slab-field is
      // editable, regardless of the skin's own class names. Skip nodes that belong
      // to a nested block so parent/child blocks don't cross-bind.
      var tagged = safeAll(sec, '[data-slab-field]').filter(function (n) {
        return n.closest('[data-slab-block]') === sec;
      });
      if (tagged.length) {
        tagged.forEach(function (n) { bindBlock(n, blockId, n.getAttribute('data-slab-field')); });
        return;
      }
      // Fallback: legacy class-selector map (the built-in 'classic' skin).
      var map = BLOCK_FIELDS[sec.getAttribute('data-slab-type')];
      if (!map) return;
      Object.keys(map).forEach(function (field) {
        bindBlock(sec.querySelector(map[field]), blockId, field);
      });
    });
  }

  function commitBlockValue(blockId, field, val) {
    var id = W.SLAB_ACTIVE_TEMPLATE_ID;
    if (!id) { status('No active template to save to', ''); return; }
    status('Saving…', 'save');
    var fd = new FormData();
    fd.append('blockId', blockId); fd.append('field', field); fd.append('value', val);
    fetch('/admin/templates/' + id + '/content-field', { method: 'POST', body: fd })
      .then(function (r) { return r.ok; })
      .then(function (ok) { status(ok ? 'Saved block field' : 'Save failed', ok ? 'ok' : ''); })
      .catch(function () { status('Save failed', ''); });
  }

  // ---- P3: images ---------------------------------------------------------
  // Service card images are a clean copy key (service{N}_image); tag those.
  function tagImages() {
    safeAll(S.doc, '.service-card,.feature-card').forEach(function (card, i) {
      var img = card.querySelector('img');
      if (!img) return;
      var key = 'service' + (i + 1) + '_image';
      img.__slabImg = key;
      img.classList.add('slab-ce-editable');
      img.setAttribute('data-slab-img', '1');
      img.setAttribute('data-slab-label', friendly(key));
    });
  }

  // ---- P4: repeater groups ------------------------------------------------
  // Each group: container selector + item selector + copy-key prefix builder.
  var REPEATERS = [
    { items: '.service-card', keys: function (n) { return { title: 'service' + n + '_title', desc: 'service' + n + '_desc' }; } },
    { items: '.feature-card', keys: function (n) { return { title: 'service' + n + '_title', desc: 'service' + n + '_desc' }; } },
    { items: '.process-list .process-item', keys: function (n) { return { title: 'process' + n + '_title', desc: 'process' + n + '_desc' }; } },
    { items: '.steps .step', keys: function (n) { return { title: 'process' + n + '_title', desc: 'process' + n + '_desc' }; } },
    { items: '.stat-box', keys: function (n) { return { title: 'about_stat' + n + '_num', desc: 'about_stat' + n + '_label' }; } },
  ];

  function tagRepeaters() {
    REPEATERS.forEach(function (r) {
      var items = safeAll(S.doc, r.items);
      if (items.length < 1) return;
      var last = items[items.length - 1];
      var container = last.parentNode;
      if (!container || container.__slabRep) return;
      container.__slabRep = r;
      container.classList.add('slab-ce-rep');
      var btn = S.doc.createElement('button');
      btn.type = 'button';
      btn.className = 'slab-ce-repbtn';
      btn.textContent = '+';
      btn.title = 'Duplicate last item';
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        duplicateItem(container, r);
      });
      container.appendChild(btn);
    });
  }

  function duplicateItem(container, r) {
    var items = safeAll(S.doc, r.items).filter(function (n) { return n.parentNode === container; });
    if (!items.length) return;
    var n = items.length;              // current count; new item = n+1
    var src = items[n - 1];
    var clone = src.cloneNode(true);
    // Strip our decoration state from the clone so it re-binds fresh.
    Array.prototype.forEach.call(clone.querySelectorAll('.slab-ce-editable'), function (el) {
      el.classList.remove('slab-ce-editable', 'slab-ce-selected', 'slab-ce-hover');
      el.removeAttribute('data-slab-label');
    });
    clone.classList.remove('slab-ce-editable', 'slab-ce-selected', 'slab-ce-hover');
    container.insertBefore(clone, container.querySelector('.slab-ce-repbtn'));
    // Persist the new copy keys as a copy of item n (so a reload matches preview).
    var srcKeys = r.keys(n), newKeys = r.keys(n + 1);
    Object.keys(newKeys).forEach(function (slot) {
      var inp = panelInput(srcKeys[slot]);
      var val = inp ? inp.value : '';
      queueCopy(newKeys[slot], val);
    });
    // Re-scan so the clone (now at nth-child n+1) picks up its bindings, then
    // drop the user straight into editing its title.
    buildIndex();
    var titleBinding = S.bindings.filter(function (b) { return b.key === newKeys.title; })[0];
    if (titleBinding) startEditing(titleBinding.node);
    status('Added item ' + (n + 1) + ' — editing', 'save');
  }

  // ---- P5: in-preview insertion (hover "+" between sections) --------------
  // A thin hover strip sits in the gap before every top-level section. On hover
  // it expands to a 35px dashed band with a "+"; clicking the "+" swaps it for a
  // dropdown of section types. Selecting one inserts at that position.
  function topSections() {
    var list = safeAll(S.doc, 'section').filter(function (s) {
      return !s.parentElement || !s.parentElement.closest('section');
    });
    var f = S.doc.querySelector('footer');
    if (f && !f.closest('section')) list.push(f);
    list.sort(function (a, b) { return (a.compareDocumentPosition(b) & 4) ? -1 : 1; });
    return list;
  }
  function tagInserts() {
    var secs = topSections();
    // Skip the gap above the very first section (nothing to anchor to).
    secs.forEach(function (sec, i) { if (i > 0) addInsertBar(sec); });
  }
  function addInsertBar(beforeSec) {
    var bar = S.doc.createElement('div');
    bar.className = 'slab-ce-ins';
    resetInsertBar(bar, beforeSec);
    beforeSec.parentNode.insertBefore(bar, beforeSec);
  }
  function resetInsertBar(bar, beforeSec) {
    bar.classList.remove('slab-ce-ins-open');
    bar.innerHTML = '<button type="button" class="slab-ce-ins-plus" title="Add a section here">+</button>';
    bar.querySelector('.slab-ce-ins-plus').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      openInsertDropdown(bar, beforeSec);
    });
  }
  // Hardcoded sections a new section can anchor to (must match the index.ejs
  // hooks + sections.js ANCHOR_SECTIONS).
  var KNOWN_ANCHORS = ['hero', 'services', 'portfolio', 'about', 'process', 'reviews', 'blog', 'contact'];
  // Derive a hardcoded section's anchor id by matching the panel's visMap
  // selectors (vis_about → '#about' → 'about'). Custom/unknown sections → null.
  function sectionAnchor(el) {
    var vm = (S.maps && S.maps.visMap) || {};
    for (var k in vm) {
      try {
        if (el.matches(vm[k])) { var a = k.replace('vis_', ''); if (KNOWN_ANCHORS.indexOf(a) !== -1) return a; }
      } catch (e) { /* bad selector — skip */ }
    }
    return null;
  }
  // Anchor for a section dropped before `beforeSec` = nearest hardcoded anchor
  // section at/above the bar (walking past custom sections). '' → end region.
  function anchorForInsert(beforeSec) {
    var secs = topSections();
    var i = secs.indexOf(beforeSec);
    for (var j = i - 1; j >= 0; j--) {
      var a = sectionAnchor(secs[j]);
      if (a) return a;
    }
    return '';
  }
  function openInsertDropdown(bar, beforeSec) {
    var anchor = anchorForInsert(beforeSec);
    bar.classList.add('slab-ce-ins-open');
    bar.innerHTML = '';
    var menu = S.doc.createElement('div');
    menu.className = 'slab-ce-ins-menu';
    SECTION_TYPES.forEach(function (t) {
      var item = S.doc.createElement('button');
      item.type = 'button';
      item.className = 'slab-ce-ins-item';
      item.textContent = t[1];
      item.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        insertSection(t[0], anchor);
      });
      menu.appendChild(item);
    });
    bar.appendChild(menu);
    // Click anywhere else closes the dropdown and restores the "+".
    var close = function (ev) {
      if (bar.contains(ev.target)) return;
      S.doc.removeEventListener('click', close, true);
      resetInsertBar(bar, beforeSec);
    };
    setTimeout(function () { S.doc.addEventListener('click', close, true); }, 0);
  }

  function insertSection(type, anchor) {
    status('Inserting…', 'save');
    var fd = new FormData();
    fd.append('type', type);
    fd.append('label', friendly(type) + ' Section');
    fd.append('anchor', anchor || '');   // renders right after this hardcoded section
    fetch('/admin/sections/custom/new', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { status('Insert failed', ''); return; }
        // One iframe reload per structural insert so the server render matches;
        // re-decoration runs on the frame 'load' hook. Still no per-keystroke load.
        reloadPreview();
        status('Section inserted', 'ok');
      })
      .catch(function () { status('Insert failed', ''); });
  }

  // ---- inline editing (P2) ------------------------------------------------
  function startEditing(node) {
    if (!node || !node.__slabEditable) return;
    if (node.getAttribute('contenteditable') === 'true') return;   // already editing — no re-bind
    selectNode(node);
    node.classList.add('slab-ce-editing');
    node.setAttribute('contenteditable', 'true');
    node.focus();
    // place caret at end
    try {
      var range = S.doc.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      var sel = S.win.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
    } catch (e) {}
    var done = false;
    var commit = function () {
      if (done) return;   // guard against blur + Enter-blur firing commit twice
      done = true;
      node.removeAttribute('contenteditable');
      node.classList.remove('slab-ce-editing');
      node.removeEventListener('blur', commit);
      node.removeEventListener('keydown', onKey);
      if (node.__slabBlock) {
        commitBlockValue(node.__slabBlock, node.__slabField, node.textContent);
      } else {
        var val = USE_INNERHTML[node.__slabProp] ? node.innerHTML : node.textContent;
        commitValue(node.__slabKey, val);
      }
    };
    var onKey = function (e) {
      if (e.key === 'Enter' && !e.shiftKey && node.__slabProp === 'textContent') { e.preventDefault(); node.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); node.blur(); }
    };
    node.addEventListener('blur', commit);
    node.addEventListener('keydown', onKey);
  }

  // Mirror into the panel input (keeps bulk-save + live-preview engine in sync)
  // AND queue a granular save.
  function commitValue(key, val) {
    var inp = panelInput(key);
    if (inp && inp.value !== val) {
      inp.value = val;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
    queueCopy(key, val);
  }

  // ---- batched save queue -------------------------------------------------
  function queueCopy(key, val) {
    S.queue[key] = val;
    status('Editing…', 'save');
    if (S.timer) clearTimeout(S.timer);
    S.timer = setTimeout(flush, 700);
  }
  function flush() {
    var keys = Object.keys(S.queue);
    if (!keys.length) return;
    var batch = S.queue; S.queue = {};
    Promise.all(keys.map(function (k) {
      var fd = new FormData(); fd.append('key', k); fd.append('value', batch[k]);
      return fetch('/admin/design/copy-key', { method: 'POST', body: fd })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    })).then(function (results) {
      var ok = results.every(Boolean);
      status(ok ? 'Saved ' + keys.length + ' change' + (keys.length > 1 ? 's' : '') : 'Some saves failed', ok ? 'ok' : '');
    });
  }

  // ---- selection loop (P1) ------------------------------------------------
  function selectNode(node) {
    if (S.selected && S.selected !== node) S.selected.classList.remove('slab-ce-selected');
    S.selected = node;
    node.classList.add('slab-ce-selected');
    openPanelFor(node.__slabKey || node.__slabImg);
  }

  // Open the matching left-bar accordion + focus the field — the "cyclical" loop.
  function openPanelFor(key) {
    if (!key) return;
    var inp = panelInput(key);
    if (!inp) { return; }
    var acc = inp.closest('[data-tab]');
    if (acc && typeof W.dpSwitch === 'function') {
      var tab = acc.getAttribute('data-tab');
      try { W.dpSwitch(tab); } catch (e) {}
    }
    var sec = inp.closest('.editor-section');
    if (sec && !sec.classList.contains('open')) sec.classList.add('open');
    try { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    inp.classList.add('slab-field-flash');
    setTimeout(function () { inp.classList.remove('slab-field-flash'); }, 1200);
  }

  // ---- image click -> asset picker ---------------------------------------
  function pickImage(img) {
    if (typeof W.openAssetPicker !== 'function') { status('Asset picker unavailable', ''); return; }
    W.openAssetPicker({
      type: 'image',
      onSelect: function (asset) {
        var url = (W.assetDeliveryUrl ? W.assetDeliveryUrl(asset) : (asset && (asset.url || asset.deliveryUrl))) || '';
        if (!url) return;
        img.src = url;                       // instant client-side swap
        if (img.__slabImg) commitValue(img.__slabImg, url);
        status('Image updated', 'ok');
      },
    });
  }

  // ---- global iframe event wiring -----------------------------------------
  function onOver(e) {
    var t = e.target.closest ? e.target.closest('.slab-ce-editable') : null;
    if (t === S.hovered) return;
    if (S.hovered) S.hovered.classList.remove('slab-ce-hover');
    S.hovered = t;
    if (t) t.classList.add('slab-ce-hover');
  }
  function onOut() { if (S.hovered) { S.hovered.classList.remove('slab-ce-hover'); S.hovered = null; } }
  function onClick(e) {
    var t = e.target.closest ? e.target.closest('.slab-ce-editable') : null;
    if (!t) return;
    // Don't hijack clicks while already editing this node.
    if (t.getAttribute('contenteditable') === 'true') return;
    e.preventDefault(); e.stopPropagation();
    if (t.getAttribute('data-slab-img') === '1') { selectNode(t); pickImage(t); return; }
    selectNode(t);
    if (t.__slabEditable) startEditing(t);
  }
  // Neutralize navigation/form submits inside the preview while editing.
  function swallowNav(e) {
    var a = e.target.closest ? e.target.closest('a,button[type="submit"]') : null;
    if (a && !a.closest('.slab-ce-repbtn') && !a.closest('.slab-ce-ins')) {
      if (a.getAttribute('contenteditable') !== 'true') e.preventDefault();
    }
  }

  // ---- enable / disable ---------------------------------------------------
  function grabFrame() {
    S.frame = document.getElementById('previewFrame');
    if (!S.frame) return false;
    try { S.doc = S.frame.contentDocument; S.win = S.frame.contentWindow; } catch (e) { S.doc = null; }
    return !!S.doc;
  }
  function reloadPreview() {
    if (S.frame) S.frame.src = '/?t=' + Date.now();
    // re-decoration happens on the frame 'load' handler below
  }

  function decorate(attempt) {
    attempt = attempt || 0;
    if (!grabFrame()) {
      console.warn('[canvas] no preview iframe found');
      status('No preview iframe', '');
      return;
    }
    // Same-origin check + readiness: contentDocument can exist while the body is
    // still null mid-load. Wait for the iframe to finish, then retry (up to ~3s).
    if (!S.doc || !S.doc.body || S.doc.readyState === 'loading') {
      if (attempt < 30) {
        console.log('[canvas] iframe not ready (attempt ' + attempt + '), retrying…');
        status('Waiting for preview…', 'save');
        if (S.frame && !S.frame.__slabWait) {
          S.frame.__slabWait = true;
          S.frame.addEventListener('load', function () { S.frame.__slabWait = false; if (S.on) decorate(0); });
        }
        setTimeout(function () { if (S.on) decorate(attempt + 1); }, 100);
        return;
      }
      console.error('[canvas] iframe body never became ready (cross-origin? blank?)');
      status('Preview not accessible', '');
      return;
    }
    S.maps = W.SlabPreviewMaps;
    if (!S.maps || !S.maps.copyMap) {
      console.error('[canvas] window.SlabPreviewMaps missing — the panel inline script did not expose the maps.');
      status('Editor maps missing', '');
      return;
    }
    injectStyles();
    buildIndex();
    var b = S.doc.body;
    b.addEventListener('mouseover', onOver, true);
    b.addEventListener('mouseout', onOut, true);
    b.addEventListener('click', onClick, true);
    b.addEventListener('click', swallowNav, true);
    b.classList.add('slab-ce-active');
    console.log('[canvas] decorated — ' + S.bindings.length + ' editable fields bound');
    status(S.bindings.length ? ('Canvas ON · ' + S.bindings.length + ' fields — hover & click') : 'Canvas ON but 0 fields matched (check markup)', S.bindings.length ? 'ok' : '');
  }

  function undecorate() {
    if (!S.doc) return;
    try {
      var b = S.doc.body;
      b.removeEventListener('mouseover', onOver, true);
      b.removeEventListener('mouseout', onOut, true);
      b.removeEventListener('click', onClick, true);
      b.removeEventListener('click', swallowNav, true);
      b.classList.remove('slab-ce-active');
      Array.prototype.forEach.call(S.doc.querySelectorAll('.slab-ce-editable'), function (n) {
        n.classList.remove('slab-ce-editable', 'slab-ce-hover', 'slab-ce-selected', 'slab-ce-editing');
        n.removeAttribute('data-slab-label'); n.removeAttribute('data-slab-img'); n.removeAttribute('contenteditable');
      });
      Array.prototype.forEach.call(S.doc.querySelectorAll('.slab-ce-repbtn,.slab-ce-ins'), function (n) { n.remove(); });
      Array.prototype.forEach.call(S.doc.querySelectorAll('.slab-ce-rep'), function (n) { n.classList.remove('slab-ce-rep'); n.__slabRep = null; });
      var st = S.doc.getElementById('slab-ce-style'); if (st) st.remove();
    } catch (e) {}
    S.selected = null; S.hovered = null;
  }

  function toggle() {
    var btn = document.getElementById('canvasEditToggle');
    S.on = !S.on;
    console.log('[canvas] toggle -> ' + (S.on ? 'ON' : 'OFF'));
    // Update the button FIRST so state is always reflected even if decorate defers.
    if (btn) {
      if (S.on) { btn.style.background = 'var(--gold)'; btn.style.color = 'var(--navy)'; btn.innerHTML = '&#10003; Editing'; }
      else { btn.style.background = ''; btn.style.color = 'var(--gold)'; btn.innerHTML = '&#9998; Edit on canvas'; }
    }
    if (S.on) {
      try { decorate(0); } catch (e) { console.error('[canvas] decorate failed:', e); status('Editor error: ' + e.message, ''); }
      // Re-decorate whenever the iframe reloads (layout change, structural save).
      if (S.frame && !S.frame.__slabHooked) {
        S.frame.__slabHooked = true;
        S.frame.addEventListener('load', function () { if (S.on) setTimeout(function () { decorate(0); }, 60); });
      }
    } else {
      flush();
      undecorate();
      status('Live Preview', '');
    }
  }

  // Public API
  W.SlabCanvas = {
    toggle: toggle,
    refresh: function () { if (S.on) decorate(0); },
    debug: function () {
      return {
        on: S.on,
        hasMaps: !!(W.SlabPreviewMaps && W.SlabPreviewMaps.copyMap),
        frame: !!document.getElementById('previewFrame'),
        docReady: !!(S.doc && S.doc.body),
        bindings: S.bindings.length,
      };
    },
    _state: S,
  };
  console.log('[canvas] canvasEditor.js loaded; SlabPreviewMaps present:', !!(W.SlabPreviewMaps && W.SlabPreviewMaps.copyMap));

  // Parent-doc styles: focused-field flash + the drag rail / chips.
  try {
    var ps = document.createElement('style');
    ps.textContent = '.slab-field-flash{outline:2px solid var(--gold,#C9A848)!important;outline-offset:1px;border-radius:3px;transition:outline .2s;}';
    document.head.appendChild(ps);
  } catch (e) {}

  // Block-model editing IS implemented: when home_source=slab renders an activated
  // template (views/template-live.ejs), buildBlockIndex()/bindBlock()/commitBlockValue()
  // bind by block id and save per-field to POST /admin/templates/:id/content-field.
  // (Per-template overrides are preserved across template switches — see templates.js.)
})();
