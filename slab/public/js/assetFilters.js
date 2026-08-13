/* Slab shared asset-filter bar — assetFilters.js
 *
 * One source of truth for "what is currently narrowing the asset grid", shared
 * by the library page (assetManager.js) and the picker modal (assetPicker.js).
 * Owns three things those two used to each do differently:
 *   1. the query-param builder for GET /admin/assets/list
 *   2. the active-filter chip row (per-chip dismiss + Clear all)
 *   3. the "showing N of M" count line
 *
 * Usage:
 *   const state = SlabAssetFilters.emptyState({ type: 'image' });
 *   fetch('/admin/assets/list?' + SlabAssetFilters.buildParams(state, { limit: 500 }));
 *   SlabAssetFilters.renderBar(barEl, state, { label, onRemove, onClearAll, count });
 */
(function () {
  'use strict';

  // Filters that narrow the result set. `sort` is deliberately absent: it
  // reorders, it never hides, so it must not read as something you can clear.
  const FILTERS = [
    { key: 'folder',   empty: 'all', name: 'Folder' },
    { key: 'type',     empty: 'all', name: 'Type' },
    { key: 'search',   empty: '',    name: 'Search' },
    { key: 'clientId', empty: '',    name: 'Client' },
    { key: 'channel',  empty: '',    name: 'Channel' },
    { key: 'campaign', empty: '',    name: 'Campaign' },
  ];

  const byKey = (key) => FILTERS.find((f) => f.key === key);
  const isActive = (f, v) => v != null && v !== '' && v !== f.empty;

  /** What "remove this chip" resets a key to. */
  function emptyValue(key) {
    const f = byKey(key);
    return f ? f.empty : '';
  }

  /** A blank filter state, optionally seeded with defaults. */
  function emptyState(over) {
    const s = {};
    FILTERS.forEach((f) => { s[f.key] = f.empty; });
    return Object.assign(s, over || {});
  }

  /** Reset every filter on an existing state object in place (keeps `sort`). */
  function clearAll(state) {
    FILTERS.forEach((f) => { state[f.key] = f.empty; });
    return state;
  }

  /** Active filters as [{ key, name, value }], in declaration order. */
  function active(state) {
    return FILTERS
      .filter((f) => isActive(f, state[f.key]))
      .map((f) => ({ key: f.key, name: f.name, value: state[f.key] }));
  }

  const anyActive = (state) => active(state).length > 0;

  /**
   * Canonical query params. Only active filters are sent — the API treats
   * absent and empty identically, so omitting them keeps the URL honest about
   * what is actually filtering.
   */
  function buildParams(state, extra) {
    const p = new URLSearchParams();
    Object.entries(extra || {}).forEach(([k, v]) => p.set(k, v));
    active(state).forEach(({ key, value }) => p.set(key, value));
    if (state.sort && state.sort !== 'newest') p.set('sort', state.sort);
    return p;
  }

  /** Read a filter state back out of a URLSearchParams (or the current URL). */
  function fromParams(params) {
    const p = params || new URLSearchParams(window.location.search);
    const s = emptyState();
    FILTERS.forEach((f) => {
      const v = p.get(f.key);
      if (v != null && v !== '') s[f.key] = v;
    });
    const sort = p.get('sort');
    if (sort) s.sort = sort;
    return s;
  }

  /* ── CHIP BAR ── */

  function injectStyles() {
    if (document.getElementById('slabAssetFilterStyles')) return;
    const s = document.createElement('style');
    s.id = 'slabAssetFilterStyles';
    s.textContent = `
      /* Themed off the admin CSS variables where they exist (library page) and
         the literal slab palette where they don't (picker modal). */
      .saf-bar {
        display:flex;align-items:center;gap:6px;flex-wrap:wrap;
        font-family:'Jost',sans-serif;font-size:0.72rem;
        color:var(--muted,#6B7380);
        padding:7px 0;min-height:30px;
      }
      .saf-bar[hidden] { display:none; }
      .saf-label {
        text-transform:uppercase;letter-spacing:0.08em;
        font-weight:700;font-size:0.62rem;opacity:0.75;margin-right:2px;
      }
      .saf-chip {
        display:inline-flex;align-items:center;gap:5px;
        padding:3px 6px 3px 8px;border-radius:2px;
        background:var(--navy-deep,#1C2B4A);color:var(--ivory,#FDFCFA);
        font-size:0.68rem;font-weight:500;line-height:1.5;
        max-width:220px;
      }
      .saf-chip-name { opacity:0.6;text-transform:uppercase;font-size:0.6rem;letter-spacing:0.06em; }
      .saf-chip-val { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .saf-chip-x {
        background:none;border:none;cursor:pointer;padding:0 1px;
        color:rgba(255,255,255,0.6);font-size:0.8rem;line-height:1;
        transition:color 0.12s;
      }
      .saf-chip-x:hover { color:#C9A848; }
      .saf-clear {
        background:none;border:1px solid var(--border,#E6E1D6);border-radius:2px;
        cursor:pointer;padding:3px 8px;color:inherit;
        font-family:inherit;font-size:0.66rem;font-weight:600;
        text-transform:uppercase;letter-spacing:0.06em;transition:all 0.12s;
      }
      .saf-clear:hover { border-color:var(--navy-mid,#2E4270);opacity:1; }
      .saf-count { margin-left:auto;font-size:0.68rem;opacity:0.7;white-space:nowrap; }
      .saf-empty-clear {
        margin-top:10px;background:none;border:1px solid var(--border,#E6E1D6);
        border-radius:2px;cursor:pointer;padding:5px 12px;color:inherit;
        font-family:'Jost',sans-serif;font-size:0.7rem;font-weight:600;
        text-transform:uppercase;letter-spacing:0.06em;
      }
      .saf-empty-clear:hover { border-color:var(--navy-mid,#2E4270); }
    `;
    document.head.appendChild(s);
  }

  /**
   * Render the active-filter chips into `container`.
   *
   * opts.label(key, value) → display string for a chip value (callers own the
   *   folder/client/channel name lookups, we only own the layout).
   * opts.onRemove(key)     → user dismissed one chip.
   * opts.onClearAll()      → user hit Clear all.
   * opts.count             → { shown, total } for the right-hand count line.
   * opts.alwaysShow        → keep the bar mounted even with no active filters
   *                          (so the count line doesn't pop in and out).
   */
  function renderBar(container, state, opts) {
    if (!container) return;
    injectStyles();
    opts = opts || {};
    const list = active(state);
    container.className = 'saf-bar';
    container.innerHTML = '';

    if (!list.length && !opts.alwaysShow) { container.hidden = true; return; }
    container.hidden = false;

    if (list.length) {
      const lbl = document.createElement('span');
      lbl.className = 'saf-label';
      lbl.textContent = 'Filtered by';
      container.appendChild(lbl);
    }

    list.forEach(({ key, name, value }) => {
      const chip = document.createElement('span');
      chip.className = 'saf-chip';

      const n = document.createElement('span');
      n.className = 'saf-chip-name';
      n.textContent = name;

      const v = document.createElement('span');
      v.className = 'saf-chip-val';
      v.textContent = opts.label ? opts.label(key, value) : value;

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'saf-chip-x';
      x.innerHTML = '&times;';
      x.title = `Remove ${name.toLowerCase()} filter`;
      x.setAttribute('aria-label', `Remove ${name.toLowerCase()} filter`);
      x.addEventListener('click', () => opts.onRemove && opts.onRemove(key));

      chip.append(n, v, x);
      container.appendChild(chip);
    });

    if (list.length > 1) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'saf-clear';
      clear.textContent = 'Clear all';
      clear.addEventListener('click', () => opts.onClearAll && opts.onClearAll());
      container.appendChild(clear);
    }

    if (opts.count) {
      const c = document.createElement('span');
      c.className = 'saf-count';
      const { shown, total } = opts.count;
      c.textContent = (shown != null && total != null && shown < total)
        ? `${shown} of ${total}`
        : `${total != null ? total : shown} asset${(total != null ? total : shown) === 1 ? '' : 's'}`;
      container.appendChild(c);
    }
  }

  /**
   * Empty-grid message that explains *why* it's empty and offers the way out.
   * Returns an element; callers append it wherever their grid lives.
   */
  function emptyMessage(state, onClearAll, fallbackHtml) {
    injectStyles();
    const wrap = document.createElement('div');
    if (!anyActive(state)) {
      wrap.innerHTML = fallbackHtml || 'No assets yet.';
      return wrap;
    }
    const n = active(state).length;
    wrap.innerHTML = `No assets match ${n === 1 ? 'this filter' : `these ${n} filters`}.`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'saf-empty-clear';
    btn.textContent = 'Clear filters';
    btn.addEventListener('click', () => onClearAll && onClearAll());
    wrap.appendChild(document.createElement('br'));
    wrap.appendChild(btn);
    return wrap;
  }

  window.SlabAssetFilters = {
    FILTERS, emptyState, emptyValue, clearAll, active, anyActive,
    buildParams, fromParams, renderBar, emptyMessage,
  };
})();
