/**
 * cards-render.js — the shared visual + animation layer for the cards platform.
 * Framework-free, canvas-2d. Any variant client (euchre, hearts, …) configures
 * into it: it owns table art, card faces/backs, fan layout, and a small flight
 * animation engine (deal / play / gather). See CARDS_RENDER_PROTOCOL.md.
 *
 * Usage:
 *   await CardsRender.loadAssets();              // preloads SD art (felt/rail/back/crest)
 *   CardsRender.loop((ctx,W,H,now) => drawBoard(ctx,W,H,now));   // starts the rAF loop
 *   CardsRender.fly({from,to,dur,draw,onDone,arc,spin});  // queue a transient animation
 *   CardsRender.cardFace(ctx,x,y,w,h,'10S');     // draw a face (top-left anchored)
 *   CardsRender.cardFaceT(ctx,cx,cy,'10S',{scale,rot}); // centered, transform-aware
 *   CardsRender.cardBack(ctx,x,y,w,h);           // draw a back (opponent hands)
 */
(function (global) {
  const SYM = { H: '\u2665', D: '\u2666', C: '\u2663', S: '\u2660' };
  const RED = { H: 1, D: 1 };
  const A = { felt: null, rail: null, back: null, crest: null };

  // Bigger cards for a definite, readable rectangle on the felt.
  const CARD_W = 64, CARD_H = 92;   // was 48x68
  const BACK_W = 44, BACK_H = 63;   // was 30x42

  function loadImage(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }
  async function loadAssets(base) {
    base = base || '/static/img/assets';
    const [felt, rail, back, crest] = await Promise.all([
      loadImage(base + '/felt.png'), loadImage(base + '/rail.png'),
      loadImage(base + '/card-back.png'), loadImage(base + '/crest.png'),
    ]);
    A.felt = felt; A.rail = rail; A.back = back; A.crest = crest;
    return A;
  }

  function parse(code) {
    const suit = code.slice(-1);
    const rank = code.slice(0, -1);
    return { rank, suit, red: !!RED[suit], sym: SYM[suit] || '?' };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- table: felt fill + rail border + faint center crest ---
  function drawTable(ctx, W, H) {
    ctx.save();
    if (A.felt) { const p = ctx.createPattern(A.felt, 'repeat'); ctx.fillStyle = p; ctx.fillRect(0, 0, W, H); }
    else { const g = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.4, W * 0.7); g.addColorStop(0, '#11643f'); g.addColorStop(1, '#0a3622'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    // a brighter "poker room" pool of light over the play area
    const lg = ctx.createRadialGradient(W / 2, H * 0.46, 20, W / 2, H * 0.46, Math.max(W, H) * 0.5);
    lg.addColorStop(0, 'rgba(255,255,240,.10)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    if (A.crest) { ctx.globalAlpha = 0.12; const s = Math.min(W, H) * 0.46; ctx.drawImage(A.crest, W / 2 - s / 2, H * 0.46 - s / 2, s, s); ctx.globalAlpha = 1; }
    const rw = 16;
    ctx.lineWidth = rw;
    if (A.rail) { ctx.strokeStyle = ctx.createPattern(A.rail, 'repeat'); }
    else { ctx.strokeStyle = '#3a2417'; }
    roundRect(ctx, rw / 2, rw / 2, W - rw, H - rw, 20); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; roundRect(ctx, rw, rw, W - 2 * rw, H - 2 * rw, 14); ctx.stroke();
    ctx.restore();
  }

  // Shared rounded-card body (fill + border) at top-left anchor.
  function cardBody(ctx, x, y, w, h, fill) {
    roundRect(ctx, x, y, w, h, Math.max(6, w * 0.11));
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // --- a single card face (top-left anchored) ---
  function cardFace(ctx, x, y, w, h, code, opt) {
    opt = opt || {};
    w = w || CARD_W; h = h || CARD_H;
    const { sym, red } = parse(code);
    const rankTxt = code.slice(0, -1);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 3;
    cardBody(ctx, x, y, w, h, '#f8f7f3');
    ctx.shadowColor = 'transparent';
    const col = red ? '#cf2f2a' : '#15171a';
    ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(h * 0.19)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(rankTxt, x + w * 0.10, y + h * 0.06);
    ctx.font = `${Math.round(h * 0.15)}px system-ui, sans-serif`;
    ctx.fillText(sym, x + w * 0.11, y + h * 0.25);
    // big center pip
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.44)}px system-ui, sans-serif`;
    ctx.fillText(sym, x + w / 2, y + h * 0.55);
    // mirrored corner
    ctx.save(); ctx.translate(x + w, y + h); ctx.rotate(Math.PI);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = col;
    ctx.font = `bold ${Math.round(h * 0.19)}px Georgia, serif`; ctx.fillText(rankTxt, w * 0.10, h * 0.06);
    ctx.restore();
    if (opt.highlight) { ctx.strokeStyle = '#2fbf71'; ctx.lineWidth = 3; roundRect(ctx, x, y, w, h, Math.max(6, w * 0.11)); ctx.stroke(); }
    ctx.restore();
  }

  // --- a face-down card back (top-left anchored) ---
  function cardBack(ctx, x, y, w, h) {
    w = w || BACK_W; h = h || BACK_H;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 3;
    roundRect(ctx, x, y, w, h, Math.max(6, w * 0.11));
    if (A.back) { ctx.save(); ctx.clip(); ctx.drawImage(A.back, x, y, w, h); ctx.restore(); }
    else { ctx.fillStyle = '#7a1620'; ctx.fill(); }
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5; roundRect(ctx, x, y, w, h, Math.max(6, w * 0.11)); ctx.stroke();
    ctx.restore();
  }

  // --- transform-aware variants: centered on (cx,cy), with scale + rotation ---
  // These power throw-ins (spin), stacks (rotation jitter), and dealer emphasis (scale).
  function cardFaceT(ctx, cx, cy, code, opt) {
    opt = opt || {};
    const scale = opt.scale == null ? 1 : opt.scale;
    const rot = opt.rot || 0;
    const w = (opt.w || CARD_W), h = (opt.h || CARD_H);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(scale, scale);
    cardFace(ctx, -w / 2, -h / 2, w, h, code, opt);
    ctx.restore();
  }
  function cardBackT(ctx, cx, cy, opt) {
    opt = opt || {};
    const scale = opt.scale == null ? 1 : opt.scale;
    const rot = opt.rot || 0;
    const w = (opt.w || BACK_W), h = (opt.h || BACK_H);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(scale, scale);
    cardBack(ctx, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // --- a stack of face-down cards with overlap offset + slight rotation jitter ---
  // Draws `n` backs at (cx,cy); each successive card offset by (dx,dy) and a small
  // deterministic rotation so the pile reads as a real stack of cards.
  function stackBacks(ctx, cx, cy, n, opt) {
    opt = opt || {};
    n = Math.max(0, n | 0);
    const dx = opt.dx == null ? 0.6 : opt.dx;
    const dy = opt.dy == null ? -0.8 : opt.dy;
    const jit = opt.jitter == null ? 0.03 : opt.jitter;
    const scale = opt.scale == null ? 1 : opt.scale;
    for (let i = 0; i < n; i++) {
      const rot = ((i * 2654435761) % 100 / 100 - 0.5) * 2 * jit; // deterministic pseudo-jitter
      cardBackT(ctx, cx + i * dx, cy + i * dy, { rot, scale });
    }
  }

  // --- fan of n cards centred on (cx,cy). vertical=true for side seats. ---
  function fanPositions(cx, cy, n, opt) {
    opt = opt || {};
    const step = opt.step != null ? opt.step : 22;
    const vertical = !!opt.vertical;
    const pts = [];
    const span = (n - 1) * step;
    for (let i = 0; i < n; i++) {
      const off = i * step - span / 2;
      pts.push(vertical ? [cx, cy + off] : [cx + off, cy]);
    }
    return pts;
  }

  // --- flight animation engine ---
  // fly({from,to,dur,draw(ctx,x,y,e),onDone, arc, spin})
  //   arc  — peak height (px) of a parabolic toss (0 = straight line)
  //   spin — total radians the card rotates during flight (passed to draw via 3rd cb arg? no:
  //          draw gets (ctx,x,y,e); we expose rotation through `e` by letting callers compute.
  // To keep draw callbacks simple we pass an enriched 4th arg: meta {e, rot, scale}.
  const flights = [];
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function fly(o) {
    flights.push({
      from: o.from, to: o.to, dur: o.dur || 280,
      draw: o.draw, onDone: o.onDone,
      arc: o.arc || 0, spin: o.spin || 0,
      scaleFrom: o.scaleFrom == null ? 1 : o.scaleFrom,
      scaleTo: o.scaleTo == null ? 1 : o.scaleTo,
      ease: o.ease === 'inout' ? easeInOut : easeOut,
      t0: performance.now() + (o.delay || 0),
    });
  }
  function busy() { return flights.length > 0; }

  let looping = false;
  function loop(drawBoard) {
    const cv = document.getElementById('felt'); if (!cv) return;
    const ctx = cv.getContext('2d');
    loop._draw = drawBoard;
    if (looping) return; looping = true;
    const frame = (now) => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      try { loop._draw && loop._draw(ctx, cv.width, cv.height, now); } catch (e) {}
      for (const f of flights) {
        if (now < f.t0) continue; // delayed start
        const raw = Math.min(1, (now - f.t0) / f.dur);
        const e = f.ease(raw);
        const x = f.from[0] + (f.to[0] - f.from[0]) * e;
        let y = f.from[1] + (f.to[1] - f.from[1]) * e;
        if (f.arc) y -= Math.sin(Math.PI * e) * f.arc;          // parabolic toss
        const rot = f.spin * (1 - e) * (f.spinDir || 1);         // settle spin to 0
        const scale = f.scaleFrom + (f.scaleTo - f.scaleFrom) * e;
        try { f.draw(ctx, x, y, e, { rot, scale }); } catch (err) {}
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        if (now >= flights[i].t0 && now - flights[i].t0 >= flights[i].dur) { const f = flights.splice(i, 1)[0]; f.onDone && f.onDone(); }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }


  // --- sound kit (WebAudio synth; no asset files; respects a mute flag) ---
  let _ac = null, _muted = false;
  function ac(){ if (!_ac){ try { _ac = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){} } return _ac; }
  function tone(freq, dur, type, gain){
    if (_muted) return; const a = ac(); if (!a) return;
    if (a.state === 'suspended') { try { a.resume(); } catch(e){} }
    const o = a.createOscillator(), g = a.createGain();
    o.type = type||'sine'; o.frequency.value = freq;
    const now = a.currentTime, vol = (gain==null?0.12:gain);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now+(dur||0.12));
    o.connect(g); g.connect(a.destination); o.start(now); o.stop(now+(dur||0.12)+0.02);
  }
  const Sound = {
    setMuted(m){ _muted = !!m; }, muted(){ return _muted; }, resume(){ const a=ac(); if(a&&a.state==='suspended'){ try{a.resume();}catch(e){} } },
    deal(){ tone(440,0.06,'triangle',0.06); },                                  // soft flick
    play(){ tone(320,0.07,'sine',0.10); setTimeout(()=>tone(210,0.07,'sine',0.07),45); }, // throw + land
    yourTurn(){ tone(660,0.10,'sine',0.12); setTimeout(()=>tone(880,0.10,'sine',0.10),90); }, // chime
    trick(){ tone(520,0.09,'triangle',0.10); setTimeout(()=>tone(390,0.12,'triangle',0.08),80); }, // sweep
    win(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,0.16,'sine',0.12),i*110)); },
    lose(){ [392,330,262].forEach((f,i)=>setTimeout(()=>tone(f,0.18,'sine',0.10),i*130)); },
    tick(){ tone(740,0.05,'square',0.05); },                                    // clock warning
    alert(){ tone(200,0.18,'sawtooth',0.10); },                                 // timeout
  };

  global.CardsRender = {
    SYM, parse, loadAssets, drawTable, cardFace, cardBack, cardFaceT, cardBackT,
    stackBacks, fanPositions, fly, busy, loop, roundRect,
    assets: A, cardW: CARD_W, cardH: CARD_H, backW: BACK_W, backH: BACK_H, Sound,
  };
})(window);
