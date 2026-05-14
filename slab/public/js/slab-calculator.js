/**
 * <slab-calculator data-slug="..." data-config-url="..."></slab-calculator>
 *
 * A configurable pricing-estimator web component for Slab tenants.
 *
 * Usage:
 *   <slab-calculator data-slug="roof-cost"></slab-calculator>
 *   <script src="/js/slab-calculator.js" defer></script>
 *
 * Config is fetched from /calculators/<slug>.json (tenant-scoped via Host).
 * Fields supported:
 *   - baseFields:        number input × costPerUnit
 *   - multiplierFields:  integer input × costPerUnit
 *   - addOns: { type:'checkbox', cost } | { type:'count', cost, max }
 *
 * Customization via CSS variables on the host element:
 *   --slab-calc-accent, --slab-calc-bg, --slab-calc-ink, --slab-calc-muted, --slab-calc-border
 */
(function () {
  if (customElements.get('slab-calculator')) return;

  const DEFAULTS = {
    accent: '#c9a848',
    bg:     'rgba(255,255,255,0.05)',
    ink:    'inherit',
    muted:  'rgba(255,255,255,0.6)',
    border: 'rgba(255,255,255,0.15)',
    radius: '8px',
    pad:    '16px',
  };

  function fmtMoney(n) {
    if (!isFinite(n)) return '$0';
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  class SlabCalculator extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._state = {};
    }

    connectedCallback() {
      this.render({ loading: true });
      this.loadConfig();
    }

    async loadConfig() {
      const slug = this.dataset.slug;
      const url  = this.dataset.configUrl || (slug ? `/calculators/${slug}.json` : null);
      if (!url) {
        return this.render({ error: 'Missing data-slug or data-config-url' });
      }
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) {
          return this.render({ error: res.status === 404 ? 'Calculator not found.' : `Error ${res.status}` });
        }
        this._config = await res.json();
        // Initialize state with defaults
        this._state = {};
        (this._config.baseFields || []).forEach(f => { this._state['base_' + f.id] = f.min || 0; });
        (this._config.multiplierFields || []).forEach(f => { this._state['mult_' + f.id] = f.min || 0; });
        (this._config.addOns || []).forEach(f => {
          this._state['add_' + f.id] = f.type === 'count' ? 0 : false;
        });
        this.render({});
      } catch (err) {
        this.render({ error: 'Failed to load calculator.' });
      }
    }

    computeTotal() {
      const c = this._config;
      let total = 0;
      (c.baseFields || []).forEach(f => {
        const v = parseFloat(this._state['base_' + f.id]) || 0;
        total += v * (f.costPerUnit || 0);
      });
      (c.multiplierFields || []).forEach(f => {
        const v = parseInt(this._state['mult_' + f.id]) || 0;
        total += v * (f.costPerUnit || 0);
      });
      (c.addOns || []).forEach(f => {
        const v = this._state['add_' + f.id];
        if (f.type === 'count') {
          total += (parseInt(v) || 0) * (f.cost || 0);
        } else if (v) {
          total += f.cost || 0;
        }
      });
      return total;
    }

    onInput(name, value, type) {
      if (type === 'checkbox') this._state[name] = !!value;
      else this._state[name] = value;
      this._updateTotal();
    }

    _updateTotal() {
      const totalEl = this.shadowRoot.querySelector('.sc-total-value');
      if (totalEl) totalEl.textContent = fmtMoney(this.computeTotal());
    }

    render({ loading, error } = {}) {
      const styles = `
        :host {
          display: block;
          --accent: var(--slab-calc-accent, ${DEFAULTS.accent});
          --bg:     var(--slab-calc-bg,     ${DEFAULTS.bg});
          --ink:    var(--slab-calc-ink,    ${DEFAULTS.ink});
          --muted:  var(--slab-calc-muted,  ${DEFAULTS.muted});
          --border: var(--slab-calc-border, ${DEFAULTS.border});
          font-family: inherit;
          color: var(--ink);
        }
        .sc-wrap {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: ${DEFAULTS.radius};
          padding: ${DEFAULTS.pad};
        }
        .sc-title { font-weight: 700; font-size: 1.05em; margin: 0 0 4px; }
        .sc-desc  { font-size: .85em; color: var(--muted); margin: 0 0 14px; }
        .sc-loading, .sc-error, .sc-disabled {
          font-size: .9em; color: var(--muted); padding: 8px 0; font-style: italic;
        }
        .sc-error { color: #fca5a5; }
        .sc-field { margin-bottom: 10px; }
        .sc-field label {
          display: block; font-size: .8em; font-weight: 600;
          color: var(--muted); margin-bottom: 4px;
          text-transform: uppercase; letter-spacing: .03em;
        }
        .sc-field input[type=number],
        .sc-field input[type=range] {
          width: 100%;
          padding: 8px 10px;
          font-size: .95em;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.05);
          color: var(--ink);
          border-radius: 4px;
          font-family: inherit;
          box-sizing: border-box;
        }
        .sc-field input:focus { outline: none; border-color: var(--accent); }
        .sc-addon-row {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 0;
          border-bottom: 1px solid var(--border);
        }
        .sc-addon-row:last-of-type { border-bottom: none; }
        .sc-addon-label { flex: 1; font-size: .9em; }
        .sc-addon-cost  { font-size: .8em; color: var(--muted); }
        .sc-addon-row input[type=checkbox] {
          width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer;
        }
        .sc-addon-row input[type=number] {
          width: 60px; padding: 4px 6px; font-size: .85em;
          border: 1px solid var(--border); border-radius: 3px;
          background: rgba(255,255,255,0.05); color: var(--ink);
        }
        .sc-section-label {
          font-size: .7em; font-weight: 700;
          color: var(--muted); text-transform: uppercase; letter-spacing: .1em;
          margin: 14px 0 6px;
        }
        .sc-total {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 0 4px; margin-top: 12px;
          border-top: 2px solid var(--accent);
        }
        .sc-total-label { font-size: .85em; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
        .sc-total-value { font-size: 1.6em; font-weight: 800; color: var(--accent); }
        .sc-note { font-size: .75em; color: var(--muted); font-style: italic; margin: 8px 0 14px; }
        .sc-cta {
          display: inline-block;
          margin-top: 8px;
          padding: 10px 22px;
          background: var(--accent);
          color: #1a1a1a;
          text-decoration: none;
          font-weight: 700;
          border-radius: 5px;
          font-size: .95em;
        }
        .sc-cta:hover { opacity: .9; }
      `;

      if (loading) {
        this.shadowRoot.innerHTML = `<style>${styles}</style><div class="sc-wrap"><div class="sc-loading">Loading calculator…</div></div>`;
        return;
      }
      if (error) {
        this.shadowRoot.innerHTML = `<style>${styles}</style><div class="sc-wrap"><div class="sc-error">${error}</div></div>`;
        return;
      }

      const c = this._config || {};
      const baseHtml = (c.baseFields || []).map(f => `
        <div class="sc-field">
          <label>${escapeHtml(f.label)}</label>
          <input type="number" data-name="base_${escapeAttr(f.id)}"
                 min="${f.min || 0}" max="${f.max || 1000}"
                 step="any" value="${f.min || 0}">
        </div>
      `).join('');

      const multHtml = (c.multiplierFields || []).map(f => `
        <div class="sc-field">
          <label>${escapeHtml(f.label)}</label>
          <input type="number" data-name="mult_${escapeAttr(f.id)}"
                 min="${f.min || 0}" max="${f.max || 10}" step="1" value="${f.min || 0}">
        </div>
      `).join('');

      const addonHtml = (c.addOns || []).map(f => {
        if (f.type === 'count') {
          return `
            <div class="sc-addon-row">
              <span class="sc-addon-label">${escapeHtml(f.label)}</span>
              <span class="sc-addon-cost">${fmtMoney(f.cost)} ea</span>
              <input type="number" data-name="add_${escapeAttr(f.id)}" min="0" max="${f.max || 10}" step="1" value="0">
            </div>
          `;
        }
        return `
          <div class="sc-addon-row">
            <input type="checkbox" data-name="add_${escapeAttr(f.id)}">
            <span class="sc-addon-label">${escapeHtml(f.label)}</span>
            <span class="sc-addon-cost">${fmtMoney(f.cost)}</span>
          </div>
        `;
      }).join('');

      const cta = c.primaryCta && c.primaryCta.url
        ? `<a class="sc-cta" href="${escapeAttr(c.primaryCta.url)}">${escapeHtml(c.primaryCta.label || 'Book')}</a>`
        : '';

      this.shadowRoot.innerHTML = `
        <style>${styles}</style>
        <div class="sc-wrap" role="region" aria-label="${escapeAttr(c.title || 'Calculator')}">
          ${c.title ? `<div class="sc-title">${escapeHtml(c.title)}</div>` : ''}
          ${c.description ? `<div class="sc-desc">${escapeHtml(c.description)}</div>` : ''}

          ${baseHtml}
          ${multHtml ? `<div class="sc-section-label">Options</div>${multHtml}` : ''}
          ${addonHtml ? `<div class="sc-section-label">Add-Ons</div>${addonHtml}` : ''}

          <div class="sc-total">
            <span class="sc-total-label">Estimated Total</span>
            <span class="sc-total-value">${fmtMoney(this.computeTotal())}</span>
          </div>
          ${c.noteText ? `<div class="sc-note">${escapeHtml(c.noteText)}</div>` : ''}
          ${cta}
        </div>
      `;

      // Wire inputs
      this.shadowRoot.querySelectorAll('[data-name]').forEach(el => {
        const name = el.dataset.name;
        el.addEventListener('input', () => {
          if (el.type === 'checkbox') this.onInput(name, el.checked, 'checkbox');
          else this.onInput(name, el.value, el.type);
        });
        el.addEventListener('change', () => {
          if (el.type === 'checkbox') this.onInput(name, el.checked, 'checkbox');
          else this.onInput(name, el.value, el.type);
        });
      });
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  customElements.define('slab-calculator', SlabCalculator);
})();
