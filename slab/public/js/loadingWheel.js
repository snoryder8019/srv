/**
 * SlabLoader — tiny, dependency-free loading spinners ("wheels") for long-running
 * actions: agent calls, image uploads, background cutout, add-to-canvas, etc.
 *
 * Global API (window.SlabLoader):
 *   SlabLoader.button(btn, on, label?)   → spinner inside a <button>; restores its
 *                                           original content when turned off.
 *   SlabLoader.overlay(target, label?)   → returns { done() }: a centred spinner
 *                                           over a positioned element.
 *   SlabLoader.wrap(btn, fn, label?)     → button(btn,true) → await fn() → button(btn,false)
 *                                           even if fn throws; returns fn's result.
 *   SlabLoader.spinnerHTML(size?)        → raw markup for embedding a wheel anywhere.
 */
(function () {
  'use strict';
  if (window.SlabLoader) return;

  // ── one-time CSS ──
  function injectCss() {
    if (document.getElementById('slabLoaderCss')) return;
    const s = document.createElement('style');
    s.id = 'slabLoaderCss';
    s.textContent = `
      @keyframes slabSpin { to { transform: rotate(360deg); } }
      .slab-wheel {
        display: inline-block; box-sizing: border-box;
        width: 1em; height: 1em; vertical-align: -0.15em;
        border: 2px solid currentColor; border-right-color: transparent;
        border-radius: 50%; animation: slabSpin 0.6s linear infinite;
        opacity: 0.85;
      }
      .slab-btn-spinning { position: relative; pointer-events: none; opacity: 0.75; }
      .slab-btn-spinning > .slab-btn-label { display: inline-flex; align-items: center; gap: 7px; }
      .slab-overlay {
        position: absolute; inset: 0; z-index: 40;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 10px; background: rgba(253,252,250,0.72);
        backdrop-filter: blur(1.5px); -webkit-backdrop-filter: blur(1.5px);
      }
      .slab-overlay .slab-wheel { width: 34px; height: 34px; border-width: 3px; color: var(--navy, #1C2B4A); }
      .slab-overlay-label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
        text-transform: uppercase; color: var(--slate, #6B7380); }
    `;
    (document.head || document.documentElement).appendChild(s);
  }
  injectCss();

  function spinnerHTML(size) {
    const style = size ? ` style="width:${size};height:${size};"` : '';
    return `<span class="slab-wheel"${style} aria-hidden="true"></span>`;
  }

  // Toggle a spinner inside a button, preserving/restoring its original content.
  function button(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (btn._slabBusy) return;
      btn._slabBusy = true;
      btn._slabPrevHtml = btn.innerHTML;
      btn._slabPrevDisabled = btn.disabled;
      const text = label != null ? label : (btn.dataset.loadingLabel || btn.textContent.trim());
      btn.classList.add('slab-btn-spinning');
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      btn.innerHTML = `<span class="slab-btn-label">${spinnerHTML()}${text ? `<span>${text}</span>` : ''}</span>`;
    } else {
      if (!btn._slabBusy) return;
      btn._slabBusy = false;
      btn.classList.remove('slab-btn-spinning');
      btn.removeAttribute('aria-busy');
      if (btn._slabPrevHtml != null) btn.innerHTML = btn._slabPrevHtml;
      btn.disabled = !!btn._slabPrevDisabled;
      delete btn._slabPrevHtml; delete btn._slabPrevDisabled;
    }
  }

  // Centred spinner overlay over any element. Returns a handle with done().
  function overlay(target, label) {
    if (!target) return { done() {} };
    const prevPos = getComputedStyle(target).position;
    if (prevPos === 'static') { target.style.position = 'relative'; target._slabPosPatched = true; }
    const el = document.createElement('div');
    el.className = 'slab-overlay';
    el.innerHTML = `${spinnerHTML()}${label ? `<div class="slab-overlay-label">${label}</div>` : ''}`;
    target.appendChild(el);
    return {
      done() {
        el.remove();
        if (target._slabPosPatched) { target.style.position = ''; delete target._slabPosPatched; }
      },
    };
  }

  // Run an async fn with the button spinning; always restores it.
  async function wrap(btn, fn, label) {
    button(btn, true, label);
    try { return await fn(); }
    finally { button(btn, false); }
  }

  window.SlabLoader = { button, overlay, wrap, spinnerHTML };
})();
