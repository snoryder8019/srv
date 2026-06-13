/**
 * damage-fx.js — the 4th wall takes the hit. A screen-space overlay that kicks
 * in at <=50% player HP: a CRACKED WINDSHIELD when you're in a ship/vehicle, or
 * BLOOD SPATTER when you're on foot. Intensifies as HP falls to zero. Driven by
 * the combat loop via window.MadlandsDamageFx.set(hpFraction, conveyance).
 * Self-contained: injects its own CSS, lazily builds the overlay, no deps.
 */
(function () {
  let el = null;

  function css() {
    if (document.getElementById('dmgfx-css')) return;
    const s = document.createElement('style'); s.id = 'dmgfx-css';
    s.textContent = `
    #dmgfx{position:fixed;inset:0;pointer-events:none;z-index:150;opacity:0;transition:opacity .3s ease;mix-blend-mode:normal}
    #dmgfx .layer{position:absolute;inset:0}
    #dmgfx .crack{display:none}
    #dmgfx.ship .crack{display:block}
    #dmgfx .crack svg{position:absolute;inset:0;width:100%;height:100%}
    #dmgfx .crack .frame{position:absolute;inset:0;box-shadow:inset 0 0 160px 36px rgba(70,8,16,.55)}
    #dmgfx .blood{display:none;background:radial-gradient(ellipse at center, rgba(120,0,0,0) 40%, rgba(128,0,12,.28) 70%, rgba(140,0,14,.6) 100%)}
    #dmgfx.foot .blood{display:block}
    #dmgfx .drip{position:absolute;top:-8px;width:16px;height:64px;border-radius:0 0 9px 9px;
      background:linear-gradient(180deg, rgba(150,0,12,0), rgba(150,0,12,.9));filter:blur(1px)}
    #dmgfx .pulse{position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(150,0,0,0) 52%, rgba(150,0,0,.2) 100%);
      animation:dmgpulse 1.7s ease-in-out infinite}
    @keyframes dmgpulse{0%,100%{opacity:.35}50%{opacity:.95}}`;
    document.head.appendChild(s);
  }

  // a jagged crack from an impact point, as an SVG polyline string
  function crackPath(cx, cy, ang, segs, step) {
    let x = cx, y = cy, a = ang, pts = `${x.toFixed(1)},${y.toFixed(1)}`;
    for (let i = 0; i < segs; i++) {
      a += (Math.random() - 0.5) * 0.9; const d = step * (0.6 + Math.random() * 0.8);
      x += Math.cos(a) * d; y += Math.sin(a) * d; pts += ` ${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return pts;
  }

  function build() {
    if (el) return el;
    css();
    el = document.createElement('div'); el.id = 'dmgfx';
    // windshield crack: an impact slightly off-centre with radiating fractures
    const ix = 60, iy = 40;
    let lines = '';
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      lines += `<polyline points="${crackPath(ix, iy, ang, 5 + (i % 3), 9)}" />`;
      // a few short forks
      if (i % 2 === 0) lines += `<polyline points="${crackPath(ix + Math.cos(ang) * 14, iy + Math.sin(ang) * 14, ang + 1.2, 3, 6)}" />`;
    }
    const svg =
      `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
         <g fill="none" stroke="rgba(230,240,255,.85)" stroke-width="0.4" stroke-linejoin="round">
           <circle cx="${ix}" cy="${iy}" r="2.4" fill="rgba(220,235,255,.5)" stroke="rgba(255,255,255,.9)" stroke-width="0.5"/>
           ${lines}
         </g>
       </svg>`;
    const drips = [12, 33, 51, 68, 86].map((p, k) =>
      `<div class="drip" style="left:${p}%;height:${44 + (k % 3) * 22}px;opacity:${0.6 + (k % 2) * 0.3}"></div>`).join('');
    el.innerHTML =
      `<div class="layer crack">${svg}<div class="frame"></div></div>` +
      `<div class="layer blood">${drips}</div>` +
      `<div class="layer pulse"></div>`;
    document.body.appendChild(el);
    return el;
  }

  // hpFrac: 0..1 (hp/hpMax). mode: 'ship'|'vehicle'|'foot'. Shows at <=0.5.
  function set(hpFrac, mode) {
    build();
    if (hpFrac == null || hpFrac > 0.5) { el.style.opacity = '0'; return; }
    const ship = (mode === 'ship' || mode === 'vehicle');
    el.classList.toggle('ship', ship);
    el.classList.toggle('foot', !ship);
    const t = Math.min(1, Math.max(0, (0.5 - hpFrac) / 0.5)); // 0 at 50% -> 1 at 0%
    el.style.opacity = String(0.3 + t * 0.7);
  }
  function clear() { if (el) el.style.opacity = '0'; }

  window.MadlandsDamageFx = { set, clear };
})();
