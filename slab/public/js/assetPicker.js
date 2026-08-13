/**
 * Asset Picker — reusable modal for selecting assets from the library.
 *
 * Usage:
 *   openAssetPicker({ folder: 'portfolio', type: 'image', onSelect: (asset) => { ... } })
 *
 * Or add a button with:
 *   <button type="button" class="btn btn-ghost btn-sm asset-pick-btn"
 *           data-target="inputFieldId" data-folder="portfolio" data-type="image">
 *     Pick from Assets
 *   </button>
 *
 * The picker injects its modal into <body> on first call.
 */
(function () {
  'use strict';

  let modalEl = null;
  let currentCallback = null;
  let searchTimeout = null;
  let foldersLoaded = false;
  let filtersPromise = null;
  let folderNames = {};   // slug → display name, for chip labels

  // Filter state for the open modal. Deliberately NOT persisted: the picker
  // used to remember the last folder/type in localStorage and let that override
  // whatever the calling surface asked for, so choosing a folder once on the
  // blog form silently scoped every other picker in the app — forever, and with
  // nothing on screen saying so. Caller scoping now wins, and shows as a chip
  // the user can dismiss.
  let pickerState = { folder: 'all', type: 'all', search: '' };

  const SAF = () => window.SlabAssetFilters;

  // The chip bar lives in a shared module; load it on demand so every view that
  // includes the picker gets it without needing its own <script> tag.
  function ensureFilters() {
    if (SAF()) return Promise.resolve();
    if (filtersPromise) return filtersPromise;
    filtersPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = '/js/assetFilters.js';
      s.onload = resolve;
      s.onerror = resolve; // degrade to a chip-less picker rather than no picker
      document.head.appendChild(s);
    });
    return filtersPromise;
  }

  function chipLabel(key, value) {
    if (key === 'folder') return folderNames[value] || value;
    if (key === 'type') return value === 'image' ? 'Images' : value === 'video' ? 'Videos' : value;
    return value;
  }

  /* ── BUILD MODAL ── */
  function buildModal() {
    if (modalEl) return;
    const el = document.createElement('div');
    el.id = 'assetPickerModal';
    el.innerHTML = `
      <div class="apm-backdrop"></div>
      <div class="apm-dialog">
        <div class="apm-header">
          <div class="apm-title">Pick an Asset</div>
          <button class="apm-close" id="apmClose">✕</button>
        </div>
        <div class="apm-toolbar">
          <input type="text" class="apm-search" id="apmSearch" placeholder="Search...">
          <div class="apm-type-tabs">
            <button class="apm-tab active" data-type="all">All</button>
            <button class="apm-tab" data-type="image">Images</button>
            <button class="apm-tab" data-type="video">Videos</button>
          </div>
          <select class="apm-folder-select" id="apmFolder">
            <option value="all">All Folders</option>
            <option value="general">General</option>
            <option value="sections">Sections</option>
            <option value="portfolio">Portfolio</option>
            <option value="blog">Blog</option>
            <option value="pages">Pages</option>
            <option value="clients">Clients</option>
          </select>
        </div>
        <div class="apm-filterbar"><div id="apmFilterBar" hidden></div></div>
        <div class="apm-grid" id="apmGrid">
          <div class="apm-loading">Loading assets...</div>
        </div>
        <div class="apm-footer">
          <span class="apm-hint">Click an asset to select it · <a href="/admin/assets" target="_blank">Manage Assets</a></span>
        </div>
      </div>`;

    el.style.cssText = 'display:none;';
    document.body.appendChild(el);
    modalEl = el;

    injectStyles();
    bindModalEvents();
  }

  function injectStyles() {
    if (document.getElementById('assetPickerStyles')) return;
    const s = document.createElement('style');
    s.id = 'assetPickerStyles';
    s.textContent = `
      #assetPickerModal { position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center; }
      .apm-backdrop { position:absolute;inset:0;background:rgba(15,27,48,0.55);backdrop-filter:blur(2px); }
      .apm-dialog {
        position:relative;z-index:1;
        width:min(920px,96vw);height:min(680px,90vh);
        background:#FDFCFA;border-radius:2px;
        display:flex;flex-direction:column;
        box-shadow:0 24px 80px rgba(15,27,48,0.22);
      }
      .apm-header {
        padding:16px 20px;border-bottom:1px solid #E6E1D6;
        display:flex;align-items:center;justify-content:space-between;
        background:#0F1B30;
        border-radius:2px 2px 0 0;
      }
      .apm-title {
        font-family:'Cormorant Garamond',serif;font-size:1.2rem;
        font-weight:400;color:#FDFCFA;
      }
      .apm-close {
        background:none;border:none;color:rgba(255,255,255,0.5);
        font-size:1.1rem;cursor:pointer;padding:4px 8px;
        transition:color 0.15s;border-radius:2px;
      }
      .apm-close:hover { color:#FDFCFA; }
      .apm-toolbar {
        padding:10px 16px;border-bottom:1px solid #E6E1D6;
        background:#F5F3EF;display:flex;gap:8px;align-items:center;flex-shrink:0;
      }
      .apm-search {
        flex:1;padding:7px 10px;border:1.5px solid #E6E1D6;border-radius:2px;
        font-size:0.82rem;font-family:'Jost',sans-serif;
        color:#0F1B30;background:#FDFCFA;
      }
      .apm-search:focus { outline:none;border-color:#2E4270; }
      .apm-type-tabs { display:flex;gap:3px;flex-shrink:0; }
      .apm-tab {
        padding:5px 10px;border-radius:2px;font-size:0.68rem;font-weight:700;
        letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;
        border:1.5px solid #E6E1D6;background:#FDFCFA;color:#6B7380;
        transition:all 0.12s;
      }
      .apm-tab:hover { border-color:#2E4270;color:#1C2B4A; }
      .apm-tab.active { background:#1C2B4A;color:#FDFCFA;border-color:#1C2B4A; }
      .apm-folder-select {
        padding:6px 8px;border:1.5px solid #E6E1D6;border-radius:2px;
        font-size:0.78rem;font-family:'Jost',sans-serif;
        color:#0F1B30;background:#FDFCFA;cursor:pointer;flex-shrink:0;
      }
      .apm-folder-select:focus { outline:none; }
      .apm-filterbar { padding:0 16px;background:#F5F3EF;flex-shrink:0; }
      .apm-filterbar .saf-bar:not([hidden]) { border-bottom:1px solid #E6E1D6; }
      .apm-grid {
        flex:1;overflow-y:auto;padding:14px 16px;
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(120px,1fr));
        grid-auto-rows:max-content;
        gap:10px;align-content:start;
        background:#F5F3EF;
      }
      .apm-card {
        background:#FDFCFA;border:2px solid transparent;border-radius:2px;
        cursor:pointer;transition:all 0.12s;overflow:hidden;
        aspect-ratio:1;display:flex;flex-direction:column;
      }
      .apm-card:hover { border-color:#E6E1D6;box-shadow:0 2px 8px rgba(15,27,48,0.08); }
      .apm-card.hover-select { border-color:#C9A848;box-shadow:0 0 0 3px rgba(201,168,72,0.15); }
      .apm-thumb {
        flex:1;overflow:hidden;background:#F5F3EF;
        display:flex;align-items:center;justify-content:center;
      }
      .apm-thumb img,.apm-thumb video { width:100%;height:100%;object-fit:cover;display:block; }
      .apm-name {
        padding:5px 7px;font-size:0.62rem;font-weight:500;
        color:#6B7380;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        border-top:1px solid #E6E1D6;
      }
      .apm-loading,.apm-empty { grid-column:1/-1;text-align:center;padding:40px;color:#6B7380;font-size:0.82rem; }
      .apm-footer {
        padding:10px 16px;border-top:1px solid #E6E1D6;background:#FDFCFA;
        font-size:0.72rem;color:#6B7380;border-radius:0 0 2px 2px;
      }
      .apm-footer a { color:#1C2B4A;text-decoration:underline; }
    `;
    document.head.appendChild(s);
  }

  function bindModalEvents() {
    // Close
    document.getElementById('apmClose').addEventListener('click', closeModal);
    modalEl.querySelector('.apm-backdrop').addEventListener('click', closeModal);

    // Search
    document.getElementById('apmSearch').addEventListener('input', e => {
      clearTimeout(searchTimeout);
      pickerState.search = e.target.value.trim();
      searchTimeout = setTimeout(loadPickerAssets, 300);
    });

    // Type tabs
    modalEl.querySelectorAll('.apm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        pickerState.type = tab.dataset.type;
        syncControls();
        loadPickerAssets();
      });
    });

    // Folder
    document.getElementById('apmFolder').addEventListener('change', e => {
      pickerState.folder = e.target.value;
      syncControls();
      loadPickerAssets();
    });
  }

  /* Push pickerState back onto the toolbar controls. Every filter change goes
     through here so the chips and the controls can never disagree. */
  function syncControls() {
    if (!modalEl) return;
    const sel = document.getElementById('apmFolder');
    if (sel) sel.value = sel.querySelector(`option[value="${pickerState.folder}"]`) ? pickerState.folder : 'all';
    modalEl.querySelectorAll('.apm-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.type === pickerState.type);
    });
    const search = document.getElementById('apmSearch');
    if (search && search.value.trim() !== pickerState.search) search.value = pickerState.search;
  }

  function clearPickerFilters() {
    pickerState.folder = 'all';
    pickerState.type = 'all';
    pickerState.search = '';
    syncControls();
    loadPickerAssets();
  }

  function removePickerFilter(key) {
    pickerState[key] = SAF() ? SAF().emptyValue(key) : (key === 'search' ? '' : 'all');
    syncControls();
    loadPickerAssets();
  }

  // Load custom folders from the API and append them to the folder <select>
  // (the markup only ships the built-in folders). Runs once per page.
  async function loadPickerFolders() {
    if (foldersLoaded) return;
    foldersLoaded = true;
    const sel = document.getElementById('apmFolder');
    if (!sel) return;
    // Seed chip labels from the built-in options already in the markup.
    sel.querySelectorAll('option').forEach(o => { folderNames[o.value] = o.textContent; });
    try {
      const r = await fetch('/admin/assets/folders');
      const data = await r.json();
      const builtIn = new Set([...sel.querySelectorAll('option')].map(o => o.value));
      (data.folders || []).forEach(f => {
        if (builtIn.has(f.slug)) return;
        const opt = document.createElement('option');
        opt.value = f.slug;
        opt.textContent = f.name;
        opt.dataset.custom = '1';
        sel.appendChild(opt);
        folderNames[f.slug] = f.name;
      });
    } catch { /* non-fatal — built-in folders still work */ }
  }

  function buildPickerParams() {
    if (SAF()) return SAF().buildParams(pickerState, { limit: 200 });
    const p = new URLSearchParams({ limit: 200 });
    if (pickerState.folder !== 'all') p.set('folder', pickerState.folder);
    if (pickerState.type !== 'all') p.set('type', pickerState.type);
    if (pickerState.search) p.set('search', pickerState.search);
    return p;
  }

  function renderPickerBar(count) {
    if (!SAF()) return;
    SAF().renderBar(document.getElementById('apmFilterBar'), pickerState, {
      label: chipLabel,
      onRemove: removePickerFilter,
      onClearAll: clearPickerFilters,
      count,
    });
  }

  async function loadPickerAssets() {
    const grid = document.getElementById('apmGrid');
    grid.innerHTML = '<div class="apm-loading">Loading...</div>';
    try {
      const r = await fetch(`/admin/assets/list?${buildPickerParams()}`);
      const data = await r.json();

      renderPickerBar({ shown: data.assets?.length || 0, total: data.total });

      if (!data.assets?.length) {
        grid.innerHTML = '';
        const empty = SAF()
          ? SAF().emptyMessage(pickerState, clearPickerFilters, 'No assets found.')
          : Object.assign(document.createElement('div'), { textContent: 'No assets found.' });
        empty.classList.add('apm-empty');
        grid.appendChild(empty);
        return;
      }

      grid.innerHTML = '';
      data.assets.forEach(asset => {
        const card = document.createElement('div');
        card.className = 'apm-card';

        let thumb = '';
        if (asset.fileType === 'image') {
          thumb = `<img src="${asset.thumbUrl || asset.publicUrl}" alt="${asset.altText || asset.title || ''}" loading="lazy" decoding="async">`;
        } else if (asset.fileType === 'video') {
          thumb = `<video src="${asset.publicUrl}" muted preload="metadata" style="pointer-events:none;"></video>`;
        } else {
          thumb = `<span style="font-size:1.8rem;color:#6B7380;">◻</span>`;
        }

        card.innerHTML = `<div class="apm-thumb">${thumb}</div><div class="apm-name">${asset.title || asset.originalName}</div>`;

        card.addEventListener('mouseenter', () => card.classList.add('hover-select'));
        card.addEventListener('mouseleave', () => card.classList.remove('hover-select'));
        card.addEventListener('click', () => {
          if (currentCallback) currentCallback(asset);
          closeModal();
        });
        grid.appendChild(card);
      });
    } catch (err) {
      grid.innerHTML = `<div class="apm-empty">Error: ${err.message}</div>`;
    }
  }

  async function openModal(opts) {
    opts = opts || {};
    await ensureFilters();
    buildModal();
    currentCallback = opts.onSelect || null;

    // Make sure custom folders are in the dropdown before we set its value.
    await loadPickerFolders();

    // Every open starts from a clean slate seeded by the CALLING surface — no
    // memory, no leakage between surfaces. The scoping is soft: it shows up as
    // a dismissable chip, so a picker opened from the blog form starts helpful
    // but is one click away from the whole library.
    const sel = document.getElementById('apmFolder');
    const folderExists = (v) => !!sel.querySelector(`option[value="${v}"]`);
    const wanted = opts.folder || 'all';
    pickerState = {
      folder: folderExists(wanted) ? wanted : 'all',
      type: opts.type || 'all',
      search: '',
    };

    syncControls();
    modalEl.style.display = '';
    loadPickerAssets();
  }

  function closeModal() {
    if (modalEl) modalEl.style.display = 'none';
    currentCallback = null;
  }

  // Front-end delivery URL for an asset: prefer the internet-safe WebP web
  // variant (capped under 1MB) and fall back to the original when no variant
  // exists yet (older uploads, videos, SVGs).
  function deliveryUrl(asset) {
    return (asset && (asset.webUrl || asset.publicUrl)) || '';
  }
  window.assetDeliveryUrl = deliveryUrl;

  /* ── AUTO-WIRE pick buttons ── */
  function wireButtons() {
    document.querySelectorAll('.asset-pick-btn').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const folder = btn.dataset.folder || 'all';
        const type = btn.dataset.type || 'all';
        openModal({
          folder, type,
          onSelect: (asset) => {
            const url = deliveryUrl(asset);
            if (targetId) {
              const input = document.getElementById(targetId);
              if (input) {
                input.value = url;
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            // Also update preview if there's a sibling preview img
            const previewId = btn.dataset.preview;
            if (previewId) {
              const img = document.getElementById(previewId);
              if (img) { img.src = url; img.style.display = ''; }
            }
          }
        });
      });
    });
  }

  // Expose globally
  window.openAssetPicker = openModal;
  window.wireAssetPickerButtons = wireButtons;

  // Auto-wire on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }
})();
