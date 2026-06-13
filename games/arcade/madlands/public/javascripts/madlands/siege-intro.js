/**
 * siege-intro.js — the reusable LAUNCH INTRO flow (the "dive" before you drop
 * into an instance). DOM-only + self-contained (injects its own CSS), so it has
 * no dependency on the map module and can be reused by any surface.
 *
 *   window.SiegeIntro.play({ mode, place, objective, iconUrl, onDone })
 *
 * Shows a cinematic: the area icon rushes toward you (the descent), the mode +
 * place + objective resolve in, a progress bar fills (~1.7s), then onDone() runs
 * (redirect to the engine for siege/defend, or enterLevel() for explore). Tap to
 * skip. This is the single moment that makes "leaving the world map" read as
 * "dropping into the place" rather than a jarring page jump.
 */
(function () {
  const THEME = {
    siege:   { label: 'SIEGE',   color: '#ffb24a', verb: 'Breaching' },
    defend:  { label: 'DEFEND',  color: '#6cc8ff', verb: 'Fortifying' },
    explore: { label: 'EXPLORE', color: '#7cffb2', verb: 'Entering' },
  };

  let styled = false;
  function injectCss() {
    if (styled) return; styled = true;
    const css = `
    .si-overlay{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(ellipse at center, rgba(10,8,20,0.72), rgba(4,3,10,0.96));
      opacity:0;transition:opacity .35s ease;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .si-overlay.on{opacity:1}
    .si-wrap{text-align:center;color:#ece8fb;transform:translateZ(0);padding:24px;max-width:min(92vw,520px)}
    .si-icon{width:148px;height:148px;margin:0 auto 14px;border-radius:24px;
      background-size:contain;background-repeat:no-repeat;background-position:center;
      filter:drop-shadow(0 0 22px var(--si-col));transform:scale(.55);opacity:0;
      transition:transform .6s cubic-bezier(.2,.8,.2,1), opacity .5s ease}
    .si-overlay.on .si-icon{transform:scale(1);opacity:1}
    .si-mode{font:700 13px/1.2 'JetBrains Mono',monospace;letter-spacing:.32em;color:var(--si-col);opacity:0;transition:opacity .4s ease .15s}
    .si-place{font:800 26px/1.15 system-ui,sans-serif;margin:6px 0 4px;opacity:0;transition:opacity .4s ease .25s}
    .si-obj{font:400 15px/1.4 system-ui,sans-serif;color:#c7c1e2;opacity:0;transition:opacity .4s ease .35s}
    .si-overlay.on .si-mode,.si-overlay.on .si-place,.si-overlay.on .si-obj{opacity:1}
    .si-bar{height:3px;width:200px;max-width:70vw;margin:20px auto 0;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}
    .si-bar > i{display:block;height:100%;width:0;background:var(--si-col);box-shadow:0 0 10px var(--si-col)}
    .si-skip{margin-top:14px;font:400 12px/1 system-ui,sans-serif;color:#8b85a8}
    @media (max-width:640px){.si-icon{width:112px;height:112px}.si-place{font-size:22px}}`;
    const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el);
  }

  function play(opts = {}) {
    injectCss();
    const mode = opts.mode || 'siege';
    const t = THEME[mode] || THEME.siege;
    const dur = opts.durationMs || 1700;

    const ov = document.createElement('div');
    ov.className = 'si-overlay';
    ov.style.setProperty('--si-col', t.color);
    const iconStyle = opts.iconUrl ? `background-image:url('${opts.iconUrl}')` : '';
    ov.innerHTML =
      `<div class="si-wrap">
         <div class="si-icon" style="${iconStyle}"></div>
         <div class="si-mode">${t.verb.toUpperCase()} · ${t.label}</div>
         <div class="si-place">${escapeHtml(opts.place || 'Unknown Reaches')}</div>
         <div class="si-obj">${escapeHtml(opts.objective || '')}</div>
         <div class="si-bar"><i></i></div>
         <div class="si-skip">tap to begin</div>
       </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('on'));

    const bar = ov.querySelector('.si-bar > i');
    requestAnimationFrame(() => { if (bar) { bar.style.transition = `width ${dur}ms linear`; bar.style.width = '100%'; } });

    let done = false;
    const finish = () => {
      if (done) return; done = true;
      ov.classList.remove('on');
      setTimeout(() => { ov.remove(); try { opts.onDone && opts.onDone(); } catch (e) { console.error('[siege-intro] onDone', e); } }, 320);
    };
    const timer = setTimeout(finish, dur);
    ov.addEventListener('click', () => { clearTimeout(timer); finish(); });
    return { finish };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.SiegeIntro = { play };
})();
