/* ─────────────────────────────────────────────────────────────────────────────
 * liveDeck.js — Live Studio control deck (shared by the encoder + the pop-out /
 * remote controller).
 *
 *  • buildUI(root, onCue)   — renders the cue buttons; calls onCue({type,...}).
 *  • OverlayEngine()        — encoder side: renders overlays into the broadcast
 *                             canvas and mixes sound cues into the broadcast audio.
 *
 * Cues are tiny JSON control messages: { type, ...payload }. All visuals are
 * drawn onto the same <canvas> the encoder streams, and all sounds are routed
 * into the same AudioContext mix node — so everything is baked into every
 * destination. Sound FX are synthesised with WebAudio (no asset files needed).
 * ──────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const SFX = ['airhorn', 'applause', 'drumroll', 'beep', 'buzzer', 'riser'];
  const FX = [['fire', '🔥 Fire'], ['confetti', '🎉 Confetti'], ['fireworks', '🎆 Fireworks']];
  const IMG_POS = [['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'], ['center', 'Center']];

  // ── Deck UI ────────────────────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('ld-css')) return;
    const s = document.createElement('style'); s.id = 'ld-css';
    s.textContent = `
      .ld-sec{margin-bottom:12px;} .ld-h{font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#8a94a6;margin-bottom:5px;}
      .ld-row{display:flex;flex-wrap:wrap;gap:6px;}
      .ld-btn{cursor:pointer;border:1px solid #2a3142;background:#1b2130;color:#e8ecf3;border-radius:7px;padding:9px 12px;font-size:0.82rem;font-weight:600;flex:1;min-width:70px;transition:transform .05s;}
      .ld-btn:active{transform:translateY(1px);}
      .ld-btn.ld-fx{background:#2a1530;border-color:#5a2a55;} .ld-btn.ld-sfx{background:#122a24;border-color:#2a5a4a;text-transform:capitalize;}
      .ld-btn.ld-ghost{background:transparent;flex:0 0 auto;} .ld-btn.ld-danger{background:#3a1620;border-color:#7a2a3a;color:#ffb4b4;}
      .ld-in{width:100%;box-sizing:border-box;margin-bottom:6px;padding:8px;border-radius:6px;border:1px solid #2a3142;background:#0f1420;color:#e8ecf3;font-size:0.8rem;}`;
    document.head.appendChild(s);
  }

  function deckHtml() {
    const btn = (attr, label, cls) => `<button type="button" class="ld-btn ${cls || ''}" ${attr}>${label}</button>`;
    return `
      <div class="ld-sec"><div class="ld-h">Animations</div><div class="ld-row">
        ${FX.map(f => btn(`data-fx="${f[0]}"`, f[1], 'ld-fx')).join('')}
      </div></div>
      <div class="ld-sec"><div class="ld-h">Sound FX</div><div class="ld-row">
        ${SFX.map(s => btn(`data-sfx="${s}"`, s, 'ld-sfx')).join('')}
      </div></div>
      <div class="ld-sec"><div class="ld-h">Lower third</div>
        <input class="ld-in d-lower-title" placeholder="Title (name)">
        <input class="ld-in d-lower-sub" placeholder="Subtitle (role / topic)">
        <div class="ld-row"><button type="button" class="ld-btn d-lower-show">Show</button><button type="button" class="ld-btn ld-ghost d-lower-hide">Hide</button></div>
      </div>
      <div class="ld-sec"><div class="ld-h">Ticker</div>
        <input class="ld-in d-ticker-text" placeholder="Scrolling banner text">
        <div class="ld-row"><button type="button" class="ld-btn d-ticker-show">Show</button><button type="button" class="ld-btn ld-ghost d-ticker-hide">Hide</button></div>
      </div>
      <div class="ld-sec"><div class="ld-h">Image / logo</div>
        <input class="ld-in d-img-url" placeholder="https://… PNG url">
        <select class="ld-in d-img-pos">${IMG_POS.map(p => `<option value="${p[0]}">${p[1]}</option>`).join('')}</select>
        <div class="ld-row"><button type="button" class="ld-btn d-img-show">Show</button><button type="button" class="ld-btn ld-ghost d-img-hide">Hide</button></div>
      </div>
      <div class="ld-sec"><button type="button" class="ld-btn ld-danger d-clear">✖ Clear all overlays</button></div>`;
  }

  function buildUI(root, onCue) {
    injectCss();
    root.innerHTML = deckHtml();
    const q = sel => root.querySelector(sel);
    root.querySelectorAll('[data-fx]').forEach(b => b.onclick = () => onCue({ type: 'fx', effect: b.dataset.fx }));
    root.querySelectorAll('[data-sfx]').forEach(b => b.onclick = () => onCue({ type: 'sfx', id: b.dataset.sfx }));
    q('.d-ticker-show').onclick = () => onCue({ type: 'ticker', on: true, text: q('.d-ticker-text').value });
    q('.d-ticker-hide').onclick = () => onCue({ type: 'ticker', on: false });
    q('.d-lower-show').onclick = () => onCue({ type: 'lower', on: true, title: q('.d-lower-title').value, sub: q('.d-lower-sub').value });
    q('.d-lower-hide').onclick = () => onCue({ type: 'lower', on: false });
    q('.d-img-show').onclick = () => onCue({ type: 'image', on: true, url: q('.d-img-url').value, pos: q('.d-img-pos').value });
    q('.d-img-hide').onclick = () => onCue({ type: 'image', on: false });
    q('.d-clear').onclick = () => onCue({ type: 'clear' });
  }

  // ── Overlay engine (encoder side) ────────────────────────────────────────────
  function OverlayEngine() {
    const ov = {
      ticker: { on: false, text: '', x: null },
      lower: { on: false, title: '', sub: '', t0: 0, out: 0 },
      image: { on: false, img: null, pos: 'tl' },
      fx: [],
    };
    const imgCache = {};
    let audio = null; // { ctx, dest } — dest is the broadcast mix (null before go-live)

    function setAudio(a) { audio = a; }

    function applyCue(cue) {
      if (!cue || !cue.type) return;
      switch (cue.type) {
        case 'fx': spawnFx(cue.effect); break;
        case 'sfx': playSfx(cue.id); break;
        case 'ticker':
          ov.ticker.on = !!cue.on;
          if (cue.on) { ov.ticker.text = String(cue.text || ''); ov.ticker.x = null; }
          break;
        case 'lower':
          if (cue.on) ov.lower = { on: true, title: String(cue.title || ''), sub: String(cue.sub || ''), t0: performance.now(), out: 0 };
          else { ov.lower.out = performance.now(); ov.lower.on = false; }
          break;
        case 'image':
          ov.image.on = !!cue.on; ov.image.pos = cue.pos || 'tl';
          if (cue.on && cue.url) {
            if (!imgCache[cue.url]) { const im = new Image(); im.crossOrigin = 'anonymous'; im.src = cue.url; imgCache[cue.url] = im; }
            ov.image.img = imgCache[cue.url];
          }
          break;
        case 'clear': ov.ticker.on = false; ov.lower.on = false; ov.lower.out = 0; ov.image.on = false; ov.fx.length = 0; break;
      }
    }

    function spawnFx(effect) {
      const now = performance.now();
      if (effect === 'confetti') {
        const ps = [];
        for (let i = 0; i < 160; i++) ps.push({ x: Math.random(), y: -0.05 - Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.0015, vy: 0.003 + Math.random() * 0.004, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, c: `hsl(${Math.floor(Math.random() * 360)},90%,60%)`, s: 6 + Math.random() * 8 });
        ov.fx.push({ type: 'confetti', born: now, life: 5000, ps });
      } else if (effect === 'fire') {
        ov.fx.push({ type: 'fire', born: now, life: 4000, ps: [] });
      } else if (effect === 'fireworks') {
        const shells = [];
        for (let i = 0; i < 4; i++) shells.push({ x: 0.2 + Math.random() * 0.6, cy: 1, ty: 0.2 + Math.random() * 0.3, delay: i * 350, exploded: false, expBorn: 0, ps: [] });
        ov.fx.push({ type: 'fireworks', born: now, life: 4800, shells });
      }
    }

    // Draw overlays on top of the base composite (FX under text/plates).
    function render(ctx, W, H) {
      const now = performance.now();
      renderFx(ctx, W, H, now);
      renderImage(ctx, W, H);
      renderLower(ctx, W, H, now);
      renderTicker(ctx, W, H);
    }

    function renderTicker(ctx, W, H) {
      if (!ov.ticker.on || !ov.ticker.text) return;
      const bh = Math.round(H * 0.075), y = H - bh;
      ctx.save();
      ctx.fillStyle = 'rgba(10,12,20,0.82)'; ctx.fillRect(0, y, W, bh);
      ctx.fillStyle = '#c0182f'; ctx.fillRect(0, y, Math.round(W * 0.02), bh);
      ctx.font = `600 ${Math.round(bh * 0.42)}px system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      const text = ov.ticker.text + '        •        ';
      const tw = ctx.measureText(text).width || 1;
      if (ov.ticker.x == null) ov.ticker.x = W;
      ov.ticker.x -= Math.max(2, W * 0.0022);
      if (ov.ticker.x < -tw) ov.ticker.x += tw;
      let x = ov.ticker.x; const midY = y + bh / 2;
      while (x < W) { ctx.fillText(text, x, midY); x += tw; }
      ctx.restore();
    }

    function renderLower(ctx, W, H, now) {
      const l = ov.lower; if (!l.on && !l.out) return;
      const dur = 280; let p;
      if (l.on) p = Math.min(1, (now - l.t0) / dur);
      else { p = 1 - Math.min(1, (now - l.out) / dur); if (p <= 0) { l.out = 0; return; } }
      const ease = 1 - Math.pow(1 - p, 3);
      const cw = Math.round(W * 0.42), ch = Math.round(H * 0.14), pad = Math.round(W * 0.03);
      const x = -cw - pad + (cw + pad + pad) * ease, y = H - ch - Math.round(H * 0.12);
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, ease));
      ctx.fillStyle = 'rgba(12,16,28,0.9)'; roundRect(ctx, x, y, cw, ch, 8); ctx.fill();
      ctx.fillStyle = '#d4af37'; ctx.fillRect(x, y, Math.round(cw * 0.018), ch);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(ch * 0.34)}px system-ui, sans-serif`;
      ctx.fillText(clip(ctx, l.title, cw - pad * 1.5), x + pad, y + ch * 0.46);
      ctx.fillStyle = '#b9c2d0'; ctx.font = `400 ${Math.round(ch * 0.24)}px system-ui, sans-serif`;
      ctx.fillText(clip(ctx, l.sub, cw - pad * 1.5), x + pad, y + ch * 0.78);
      ctx.restore();
    }

    function renderImage(ctx, W, H) {
      const im = ov.image; if (!im.on || !im.img || !im.img.complete || !im.img.naturalWidth) return;
      const iw = Math.round(W * 0.2), ih = iw * (im.img.naturalHeight / im.img.naturalWidth), pad = Math.round(W * 0.03);
      let x, y; const p = im.pos;
      if (p === 'tr') { x = W - iw - pad; y = pad; }
      else if (p === 'bl') { x = pad; y = H - ih - pad; }
      else if (p === 'br') { x = W - iw - pad; y = H - ih - pad; }
      else if (p === 'center') { x = (W - iw) / 2; y = (H - ih) / 2; }
      else { x = pad; y = pad; }
      ctx.save(); ctx.drawImage(im.img, x, y, iw, ih); ctx.restore();
    }

    function renderFx(ctx, W, H, now) {
      for (let i = ov.fx.length - 1; i >= 0; i--) {
        const f = ov.fx[i]; if (now - f.born > f.life) { ov.fx.splice(i, 1); continue; }
        if (f.type === 'confetti') drawConfetti(ctx, W, H, f);
        else if (f.type === 'fire') drawFire(ctx, W, H, f, now - f.born);
        else if (f.type === 'fireworks') drawFireworks(ctx, W, H, f, now - f.born);
      }
    }

    function drawConfetti(ctx, W, H, f) {
      ctx.save();
      for (const p of f.ps) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.00008; p.r += p.vr;
        const px = p.x * W, py = p.y * H; if (py > H + 20) continue;
        ctx.save(); ctx.translate(px, py); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
      }
      ctx.restore();
    }

    function drawFire(ctx, W, H, f, age) {
      const now = performance.now();
      const emit = age < f.life - 800 ? 14 : 0;
      for (let i = 0; i < emit; i++) f.ps.push({ x: 0.2 + Math.random() * 0.6, y: 1.02, vy: 0.006 + Math.random() * 0.006, vx: (Math.random() - 0.5) * 0.001, life: 600 + Math.random() * 500, born: now, s: 10 + Math.random() * 22 });
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = f.ps.length - 1; i >= 0; i--) {
        const p = f.ps[i]; const a = (now - p.born) / p.life; if (a >= 1) { f.ps.splice(i, 1); continue; }
        p.y -= p.vy; p.x += p.vx; const px = p.x * W, py = p.y * H; const hue = 45 - 35 * a; const alpha = (1 - a) * 0.7; const rad = p.s * (1 + a);
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, `hsla(${hue},100%,60%,${alpha})`); g.addColorStop(1, 'hsla(20,100%,40%,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
      }
      ctx.restore();
    }

    function drawFireworks(ctx, W, H, f, age) {
      const now = performance.now();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const sh of f.shells) {
        if (age < sh.delay) continue;
        if (!sh.exploded) {
          const t = (age - sh.delay) / 500; sh.cy = 1 + (sh.ty - 1) * Math.min(1, t);
          if (t >= 1) {
            sh.exploded = true; sh.expBorn = now; const hue = Math.floor(Math.random() * 360);
            for (let i = 0; i < 70; i++) { const ang = Math.random() * 7, sp = 0.0025 + Math.random() * 0.004; sh.ps.push({ x: sh.x, y: sh.ty, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, hue }); }
          } else { ctx.fillStyle = '#ffd'; ctx.beginPath(); ctx.arc(sh.x * W, sh.cy * H, 3, 0, 7); ctx.fill(); }
        }
        if (sh.exploded) {
          const ea = (now - sh.expBorn) / 1400; if (ea >= 1) continue;
          for (const p of sh.ps) { p.x += p.vx; p.y += p.vy; p.vy += 0.00006; ctx.fillStyle = `hsla(${p.hue},100%,65%,${1 - ea})`; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 2.5, 0, 7); ctx.fill(); }
        }
      }
      ctx.restore();
    }

    // ── Sound synthesis → broadcast mix (audio.dest) + local monitor ────────────
    function playSfx(id) {
      if (!audio || !audio.ctx) audio = ensureLocalAudio();
      const ctx = audio.ctx; if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const outs = [ctx.destination]; if (audio.dest) outs.push(audio.dest);
      const connect = node => outs.forEach(o => node.connect(o));
      const t = ctx.currentTime;
      if (id === 'beep') tone(ctx, connect, 880, 'sine', t, 0.15, 0.3);
      else if (id === 'buzzer') tone(ctx, connect, 120, 'square', t, 0.5, 0.25);
      else if (id === 'airhorn')[0, 3, 7].forEach(d => tone(ctx, connect, 233 * Math.pow(2, d / 12), 'sawtooth', t, 0.9, 0.16, true));
      else if (id === 'riser') { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(1400, t + 2); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 1.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1); o.connect(g); connect(g); o.start(t); o.stop(t + 2.2); }
      else if (id === 'drumroll') { noise(ctx, connect, t, 1.4, 0.25, true, false); noise(ctx, connect, t + 1.4, 0.25, 0.4, false, false); }
      else if (id === 'applause') noise(ctx, connect, t, 3, 0.22, false, true);
    }
    function tone(ctx, connect, freq, type, t, dur, vol, vib) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
      if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6; lg.gain.value = freq * 0.03; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur); }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); connect(g); o.start(t); o.stop(t + dur);
    }
    function noise(ctx, connect, t, dur, vol, tremolo, swell) {
      const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf; const g = ctx.createGain();
      if (swell) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur); }
      else { g.gain.setValueAtTime(vol, t); if (tremolo) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.type = 'square'; l.frequency.value = 18; lg.gain.value = vol * 0.6; l.connect(lg); lg.connect(g.gain); l.start(t); l.stop(t + dur); } g.gain.setValueAtTime(vol, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = swell ? 2500 : 1200; bp.Q.value = 0.7;
      src.connect(bp); bp.connect(g); connect(g); src.start(t); src.stop(t + dur);
    }
    function ensureLocalAudio() { const AC = window.AudioContext || window.webkitAudioContext; return { ctx: new AC(), dest: null }; }

    return { applyCue, render, setAudio, state: ov };
  }

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function clip(ctx, text, maxw) { text = String(text || ''); if (ctx.measureText(text).width <= maxw) return text; while (text.length && ctx.measureText(text + '…').width > maxw) text = text.slice(0, -1); return text + '…'; }

  global.LiveDeck = { buildUI, OverlayEngine, CUES: { SFX, FX } };
})(window);
