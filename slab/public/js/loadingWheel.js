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

  // ────────────────────────────────────────────────────────────────────────
  // SlabFlash — obvious success/failure toast messaging (matches the signup
  // confirmation vibe). The house style for "your post went out" / "that
  // failed" feedback across every admin action.
  // ────────────────────────────────────────────────────────────────────────
  function injectFlashCss() {
    if (document.getElementById('slabFlashCss')) return;
    const s = document.createElement('style');
    s.id = 'slabFlashCss';
    s.textContent = `
      @keyframes slabFlashIn  { from { opacity:0; transform:translateY(-14px) scale(0.98); } to { opacity:1; transform:none; } }
      @keyframes slabFlashOut { from { opacity:1; transform:none; } to { opacity:0; transform:translateY(-10px) scale(0.98); } }
      .slab-flash-wrap {
        position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
        z-index: 100000; display: flex; flex-direction: column; gap: 10px;
        width: min(440px, calc(100vw - 28px)); pointer-events: none;
      }
      /* Branded by the tenant's palette: the card wears the brand surface, text,
         border, radius and font; only a semantic accent bar + icon carry the
         success/error/warn/info meaning. Every value falls back to a sane
         default so it still renders on public pages that lack the brand vars. */
      .slab-flash {
        pointer-events: auto; display: flex; align-items: flex-start; gap: 11px;
        padding: 13px 15px; font-size: 0.86rem; line-height: 1.4;
        font-family: var(--font-body, system-ui, sans-serif); font-weight: 500;
        background: var(--surface, #FDFCFA); color: var(--on-surface, #0F1B30);
        border: 1px solid var(--border, #CBD5E1);
        border-left: 4px solid var(--slab-flash-accent, var(--navy, #1C2B4A));
        border-radius: calc(var(--card-radius, 4px) + 2px);
        box-shadow: 0 10px 34px rgba(15,27,48,0.22);
        animation: slabFlashIn 0.22s cubic-bezier(0.2,0.8,0.3,1) both;
      }
      .slab-flash.leaving { animation: slabFlashOut 0.2s ease forwards; }
      .slab-flash-ic { flex-shrink: 0; font-size: 1.05rem; line-height: 1.25; color: var(--slab-flash-accent, var(--navy, #1C2B4A)); }
      .slab-flash-msg { flex: 1; min-width: 0; word-break: break-word; }
      .slab-flash-x { flex-shrink: 0; background: none; border: none; cursor: pointer;
        font-size: 1rem; line-height: 1; opacity: 0.5; padding: 2px; color: inherit; }
      .slab-flash-x:hover { opacity: 1; }
      /* Optional action button (e.g. Undo). Wears the semantic accent so it reads
         as the toast's one affordance without competing with the dismiss ×. */
      .slab-flash-act { flex-shrink: 0; align-self: center; cursor: pointer;
        background: none; border: 1px solid var(--slab-flash-accent, var(--navy, #1C2B4A));
        color: var(--slab-flash-accent, var(--navy, #1C2B4A));
        font-family: inherit; font-size: 0.7rem; font-weight: 700;
        letter-spacing: 0.08em; text-transform: uppercase;
        padding: 5px 10px; border-radius: var(--card-radius, 4px);
        transition: background 0.15s, color 0.15s; }
      .slab-flash-act:hover { background: var(--slab-flash-accent, var(--navy, #1C2B4A)); color: var(--surface, #FDFCFA); }
      .slab-flash-act-ct { font-variant-numeric: tabular-nums; opacity: 0.75; }
      .slab-flash.success { --slab-flash-accent: var(--success, #15803D); }
      .slab-flash.error   { --slab-flash-accent: var(--danger,  #B91C1C); }
      .slab-flash.warn    { --slab-flash-accent: var(--warn,    #B45309); }
      .slab-flash.info    { --slab-flash-accent: var(--gold,    #C9A848); }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function flashWrap() {
    let w = document.getElementById('slabFlashWrap');
    if (!w) {
      injectFlashCss();
      w = document.createElement('div');
      w.id = 'slabFlashWrap';
      w.className = 'slab-flash-wrap';
      (document.body || document.documentElement).appendChild(w);
    }
    return w;
  }

  const FLASH_ICONS = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };

  // flash(message, type='info', opts)
  //   opts: { timeout (ms), sticky (bool),
  //           action: { label, onClick, countdown (bool) } }
  //
  // `action` renders a single affordance inside the toast — built for "did a
  // batch of things, here's your way out" flows (agent field-fills, bulk edits).
  // With `countdown:true` the label shows the seconds left before auto-dismiss,
  // so the window to act is visible rather than guessed at.
  function flash(message, type, opts) {
    if (!message) return { dismiss() {} };
    type = type || 'info';
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'slab-flash ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const ic = document.createElement('span');
    ic.className = 'slab-flash-ic'; ic.textContent = FLASH_ICONS[type] || FLASH_ICONS.info;
    const msg = document.createElement('span');
    msg.className = 'slab-flash-msg'; msg.textContent = String(message);
    const x = document.createElement('button');
    x.className = 'slab-flash-x'; x.type = 'button'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×';
    el.appendChild(ic); el.appendChild(msg);

    const ms = opts.timeout || (type === 'error' ? 7000 : 4500);
    let tick = null;
    if (opts.action && typeof opts.action.onClick === 'function') {
      const act = document.createElement('button');
      act.className = 'slab-flash-act'; act.type = 'button';
      const baseLabel = opts.action.label || 'Undo';
      act.textContent = baseLabel;
      if (opts.action.countdown && !opts.sticky) {
        const ct = document.createElement('span');
        ct.className = 'slab-flash-act-ct';
        act.textContent = baseLabel + ' ';
        act.appendChild(ct);
        let left = Math.ceil(ms / 1000);
        ct.textContent = left + 's';
        tick = setInterval(() => {
          left -= 1;
          if (left <= 0) { clearInterval(tick); return; }
          ct.textContent = left + 's';
        }, 1000);
      }
      act.addEventListener('click', () => {
        try { opts.action.onClick(); } finally { dismiss(); }
      });
      el.appendChild(act);
    }
    el.appendChild(x);
    flashWrap().appendChild(el);
    let timer = null;
    function dismiss() {
      if (el._gone) return; el._gone = true;
      if (timer) clearTimeout(timer);
      if (tick) clearInterval(tick);
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 300);
    }
    x.addEventListener('click', dismiss);
    if (!opts.sticky) timer = setTimeout(dismiss, ms);
    return { dismiss, el };
  }

  // Surface a redirect's ?success= / ?error= / ?flash= as a toast, then strip
  // it from the address bar so a refresh doesn't re-fire it. Call once per page
  // (pages that render their own inline .alert should NOT also call this).
  function flashFromUrl() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (_) { return; }
    const s = params.get('success'), e = params.get('error'), w = params.get('warn');
    let shown = false;
    if (s) { flash(s, 'success'); shown = true; }
    if (e) { flash(e, 'error'); shown = true; }
    if (w) { flash(w, 'warn'); shown = true; }
    if (shown) {
      params.delete('success'); params.delete('error'); params.delete('warn');
      const q = params.toString();
      try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); } catch (_) {}
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // guardForm — one-shot submit guard for classic (navigating) POST forms.
  // On the first submit: blocks re-entry, disables every submit control,
  // spins the clicked button, and drops a grey overlay on the form. No unlock
  // is needed because the redirect reloads the page. Opt in with
  // <form data-guard> (auto-wired below) or call SlabLoader.guardForm(form).
  // ────────────────────────────────────────────────────────────────────────
  function guardForm(form, submitter) {
    if (!form || form._slabSubmitting) return false;
    form._slabSubmitting = true;
    const controls = form.querySelectorAll('button[type=submit], input[type=submit], button:not([type])');
    const btn = submitter || form.querySelector('button[type=submit]');
    // A named submit button (e.g. <button name="action" value="autoslot">) normally
    // contributes its name/value to the POST. But we're about to DISABLE it for the
    // double-click guard, and a submitter disabled during the submit event is dropped
    // from the payload by the browser — so the server would never see which button
    // was pressed. Preserve it as a hidden field first. (Only for a real navigating
    // submit; AJAX forms don't route through here.)
    if (btn && btn.name && !form._slabSubmitPreserved) {
      const keep = document.createElement('input');
      keep.type = 'hidden'; keep.name = btn.name; keep.value = btn.value;
      form.appendChild(keep);
      form._slabSubmitPreserved = true;
    }
    controls.forEach(c => { if (c !== btn) c.disabled = true; });
    if (btn) button(btn, true, btn.dataset.loadingLabel || null);
    // data-guard="button" → spin the button only (for tiny inline forms);
    // otherwise drop a grey overlay over the whole form.
    if (form.dataset.guard !== 'button') overlay(form, form.dataset.guardLabel || null);
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────
  // post — AJAX submit protocol: guard → disable+spinner → (optional) overlay →
  // fetch → flash success/error from the JSON response → UNLOCK the button.
  // This is the "disable on click, wait for a response code, then re-enable"
  // pattern for fetch-based actions.
  //
  //   SlabLoader.post(btn, url, {
  //     body, method='POST', overlayTarget, loadingLabel,
  //     successMessage, errorMessage,
  //     onSuccess(data), onError(data|err),
  //   })
  // Treats HTTP 2xx AND JSON { ok:true } as success. Returns the parsed body
  // (or null on failure). The button is always re-enabled in a finally.
  // ────────────────────────────────────────────────────────────────────────
  async function post(btn, url, opts) {
    opts = opts || {};
    if (btn && btn._slabBusy) return null;              // impatient re-click guard
    const ov = opts.overlayTarget ? overlay(opts.overlayTarget, opts.overlayLabel) : null;
    button(btn, true, opts.loadingLabel || null);
    try {
      const init = { method: opts.method || 'POST', headers: { 'Accept': 'application/json' } };
      if (opts.body !== undefined && opts.body !== null) {
        init.headers['Content-Type'] = 'application/json';
        init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }
      if (opts.headers) Object.assign(init.headers, opts.headers);
      const res = await fetch(url, init);
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      const ok = res.ok && (!data || data.ok !== false);
      if (ok) {
        const m = opts.successMessage || (data && data.message);
        if (m) flash(m, 'success');
        if (opts.onSuccess) opts.onSuccess(data, res);
        return data;
      }
      const em = opts.errorMessage || (data && (data.error || data.message)) ||
                 ('Request failed (' + res.status + ')');
      flash(em, 'error');
      if (opts.onError) opts.onError(data, res);
      return null;
    } catch (err) {
      flash(opts.errorMessage || 'Network error — please try again.', 'error');
      if (opts.onError) opts.onError(err);
      return null;
    } finally {
      button(btn, false);
      if (ov) ov.done();
    }
  }

  // Auto-wire: any <form data-guard> gets the classic-submit guard for free.
  // Bubble phase at the document so this runs AFTER any form-level handler
  // (captcha, AJAX) — e.defaultPrevented then reflects their decision: if they
  // preventDefault (own the submit / cancelled a confirm) we stay out of the way;
  // only a real navigating submit gets guarded.
  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || form.nodeName !== 'FORM') return;
    if (!form.hasAttribute('data-guard')) return;
    if (e.defaultPrevented) return;                     // handler owns / cancelled it
    if (!guardForm(form, e.submitter)) { e.preventDefault(); return; }  // already sent
  }, false);

  window.SlabLoader = { button, overlay, wrap, spinnerHTML, flash, flashFromUrl, guardForm, post };
  window.SlabFlash = { show: flash, fromUrl: flashFromUrl,
    success: (m, o) => flash(m, 'success', o), error: (m, o) => flash(m, 'error', o),
    warn: (m, o) => flash(m, 'warn', o), info: (m, o) => flash(m, 'info', o) };
})();
