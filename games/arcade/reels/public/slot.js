/**
 * Reels client — canvas reel strips with cylinder shading, lit controls, drag
 * handle, Diamond Vault pick bonus, big-win confetti. Outcomes come from
 * POST /api/spin; the client only animates to the server's stops.
 */
(function () {
  'use strict';

  // ───────────────────────── SFX (synth, no assets) ─────────────────────────
  // ───────────────────────── SFX (synth onto the shared arcade audiobus) ─────────────────────────
  // Reels keeps its bespoke synthesized sounds but routes them through the
  // SHARED audiobus channels (fx / win) so it inherits the unified mixer + mute.
  // The bus is loaded dynamically; until it resolves, sound calls are queued.
  var SFX = (function () {
    var BUS_URL = 'https://games.madladslab.com/shared/js/audiobus.js';
    var bus = null, ctx = null, ready = false, q = [];
    function boot() {
      if (bus || boot._started) return; boot._started = true;
      import(BUS_URL).then(function (mod) {
        bus = mod.createAudioBus({ channels: ['music', 'fx', 'win'] });
        bus.resume();
        ctx = bus.context();
        ready = true;
        // mount the shared mixer on our speaker button
        var mb = document.getElementById('mixBtn'); if (mb) bus.buildMixer(mb);
        q.forEach(function (fn) { try { fn(); } catch (e) {} }); q = [];
      }).catch(function () { /* audio stays silent if bus fails to load */ });
    }
    function on(ch) { return bus ? bus.channelNode(ch) : null; }
    function chFx() { return on('fx'); }
    function chWin() { return on('win'); }
    function run(fn) { if (ready) fn(); else { q.push(fn); boot(); } }

    function env(node, t0, a, d, peak, sus) {
      var g = node.gain; g.cancelScheduledValues(t0);
      g.setValueAtTime(0.0001, t0);
      g.exponentialRampToValueAtTime(peak, t0 + a);
      if (sus != null) { g.exponentialRampToValueAtTime(Math.max(0.0001, sus), t0 + a + d); }
      else { g.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
    }
    function tone(type, f0, f1, t0, dur, peak, dest) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      env(g, t0, Math.min(0.02, dur * 0.2), dur, peak);
      o.connect(g); g.connect(dest || chFx()); o.start(t0); o.stop(t0 + dur + 0.05);
      return o;
    }
    function noise(t0, dur, peak, filterType, freq, dest) {
      var n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource(); src.buffer = buf;
      var f = ctx.createBiquadFilter(); f.type = filterType || 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.8;
      var g = ctx.createGain(); env(g, t0, 0.005, dur, peak);
      src.connect(f); f.connect(g); g.connect(dest || chFx()); src.start(t0); src.stop(t0 + dur + 0.02);
    }
    var api = {
      unlock: function () { boot(); if (bus) bus.resume(); },
      pull: function () { run(function () { var t = ctx.currentTime;
        tone('sawtooth', 320, 90, t, 0.18, 0.5); noise(t, 0.12, 0.35, 'lowpass', 800); tone('square', 140, 70, t + 0.10, 0.12, 0.3); }); },
      spinStart: function () { run(function () { var t = ctx.currentTime;
        noise(t, 0.5, 0.12, 'bandpass', 2600); tone('triangle', 220, 520, t, 0.45, 0.16); }); },
      reelStop: function (i) { run(function () { var t = ctx.currentTime;
        tone('square', 180 - i * 18, 70, t, 0.07, 0.4); noise(t, 0.05, 0.3, 'highpass', 1800); }); },
      win: function (tier) { run(function () { var t = ctx.currentTime;
        var notes = [523, 659, 784, 1047, 1319, 1568]; var n = tier >= 3 ? 6 : tier >= 2 ? 4 : 3;
        for (var k = 0; k < n; k++) { tone('triangle', notes[k], notes[k], t + k * 0.085, 0.22, 0.42, chWin()); tone('sine', notes[k] * 2, notes[k] * 2, t + k * 0.085, 0.18, 0.16, chWin()); } }); },
      coin: function () { run(function () { var t = ctx.currentTime;
        tone('square', 1320, 1760, t, 0.06, 0.3, chWin()); tone('square', 1760, 2200, t + 0.03, 0.05, 0.22, chWin()); }); },
      bell: function (rings) { run(function () { var t0 = ctx.currentTime; rings = rings || 2;
        for (var r = 0; r < rings; r++) { var t = t0 + r * 0.34;
          var partials = [[1, 0.5], [2.76, 0.28], [5.4, 0.16], [8.1, 0.09]]; var fund = 660;
          partials.forEach(function (p) { var o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = fund * p[0];
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p[1], t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
            o.connect(g); g.connect(chWin()); o.start(t); o.stop(t + 0.95); });
          noise(t, 0.03, 0.25, 'bandpass', 4000, chWin()); } }); },
      jackpot: function () { run(function () { var t = ctx.currentTime;
        var notes = [523, 659, 784, 1047, 1319, 1568, 2093];
        notes.forEach(function (f, k) { tone('triangle', f, f, t + k * 0.07, 0.5, 0.4, chWin()); tone('sine', f * 1.5, f * 1.5, t + k * 0.07, 0.4, 0.14, chWin()); });
        noise(t, 0.6, 0.1, 'highpass', 5000, chWin()); }); }
    };
    return api;
  })();

  // ───────────────────────── state ─────────────────────────
  var machine = null;
  var chips = null;
  var session = { machine: { wagered: 0, won: 0 }, total: { wagered: 0, won: 0 } };
  var freeSpins = null;
  var sel = { denom: null, lines: null, betLevel: null };
  var spinning = false;
  var vaultOpen = false;
  var MACHINE_SLUG = (new URLSearchParams(location.search).get('m') || 'classic-diamond').replace(/[^a-z0-9-]/gi,'');

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Number(n || 0).toLocaleString(); };

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // marquee chase bulbs
  (function bulbs() {
    ['bulbsTop', 'bulbsBottom'].forEach(function (id, rowI) {
      var row = $(id); if (!row) return;
      for (var i = 0; i < 16; i++) {
        var b = document.createElement('span'); b.className = 'bulb';
        b.style.animationDelay = (((i + rowI * 8) % 16) * 0.075) + 's';
        row.appendChild(b);
      }
    });
  })();

  // ───────────────────────── symbol art (vector, canvas) ─────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawBar(ctx, s, n) {
    var bh = s * 0.16, gap = s * 0.05, total = n * bh + (n - 1) * gap, y0 = -total / 2;
    for (var i = 0; i < n; i++) {
      var y = y0 + i * (bh + gap);
      var g = ctx.createLinearGradient(0, y, 0, y + bh);
      g.addColorStop(0, '#3a3e47'); g.addColorStop(0.5, '#1c1f25'); g.addColorStop(1, '#33363e');
      roundRect(ctx, -s * 0.38, y, s * 0.76, bh, bh * 0.3);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#caa53d'; ctx.lineWidth = Math.max(1, s * 0.018); ctx.stroke();
      ctx.fillStyle = '#f5d56b'; ctx.font = '900 ' + (bh * 0.72) + 'px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('BAR', 0, y + bh / 2 + bh * 0.04);
      // top sheen
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, -s * 0.36, y + bh * 0.08, s * 0.72, bh * 0.22, bh * 0.12); ctx.fill();
    }
  }
  var ART = {
    cherry: function (ctx, s) {
      ctx.strokeStyle = '#3e7a2f'; ctx.lineWidth = s * 0.05; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-s * 0.10, s * 0.10); ctx.quadraticCurveTo(-s * 0.05, -s * 0.30, s * 0.16, -s * 0.34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.16, s * 0.14); ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s * 0.16, -s * 0.34); ctx.stroke();
      ctx.fillStyle = '#3e7a2f';
      ctx.beginPath(); ctx.ellipse(s * 0.22, -s * 0.34, s * 0.13, s * 0.07, -0.5, 0, Math.PI * 2); ctx.fill();
      var grad = function (cx, cy) {
        var g = ctx.createRadialGradient(cx - s * 0.05, cy - s * 0.06, s * 0.02, cx, cy, s * 0.17);
        g.addColorStop(0, '#ff8d7d'); g.addColorStop(0.45, '#e23a25'); g.addColorStop(1, '#8e0e05'); return g;
      };
      ctx.fillStyle = grad(-s * 0.12, s * 0.18); ctx.beginPath(); ctx.arc(-s * 0.12, s * 0.18, s * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = grad(s * 0.17, s * 0.22); ctx.beginPath(); ctx.arc(s * 0.17, s * 0.22, s * 0.16, 0, Math.PI * 2); ctx.fill();
      // specular dots
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(-s * 0.17, s * 0.12, s * 0.035, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.12, s * 0.16, s * 0.035, 0, Math.PI * 2); ctx.fill();
    },
    lemon: function (ctx, s) {
      var g = ctx.createRadialGradient(-s * 0.10, -s * 0.12, s * 0.03, 0, 0, s * 0.42);
      g.addColorStop(0, '#fff7a8'); g.addColorStop(0.55, '#ffe23e'); g.addColorStop(1, '#d8a900');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.34, s * 0.24, -0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c79c00';
      ctx.beginPath(); ctx.ellipse(s * 0.30, -s * 0.13, s * 0.05, s * 0.03, -0.35, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-s * 0.30, s * 0.13, s * 0.05, s * 0.03, -0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(-s * 0.12, -s * 0.10, s * 0.10, s * 0.05, -0.5, 0, Math.PI * 2); ctx.fill();
    },
    seven: function (ctx, s) {
      ctx.font = '900 ' + (s * 0.82) + 'px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = s * 0.09; ctx.strokeStyle = '#6d0f04'; ctx.strokeText('7', 0, s * 0.03);
      var g = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.4);
      g.addColorStop(0, '#ff9678'); g.addColorStop(0.45, '#e83518'); g.addColorStop(1, '#8e1102');
      ctx.fillStyle = g; ctx.fillText('7', 0, s * 0.03);
      // gloss sweep on upper half
      ctx.save();
      ctx.beginPath(); ctx.rect(-s * 0.5, -s * 0.45, s, s * 0.32); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fillText('7', 0, s * 0.03);
      ctx.restore();
    },
    bar:  function (ctx, s) { drawBar(ctx, s, 1); },
    bar2: function (ctx, s) { drawBar(ctx, s, 2); },
    bar3: function (ctx, s) { drawBar(ctx, s, 3); },
    diamond: function (ctx, s) {
      var pts = [[0, -s * 0.34], [s * 0.30, -s * 0.10], [0, s * 0.36], [-s * 0.30, -s * 0.10]];
      var g = ctx.createLinearGradient(-s * 0.3, -s * 0.3, s * 0.3, s * 0.36);
      g.addColorStop(0, '#dff8ff'); g.addColorStop(0.45, '#3fb8e8'); g.addColorStop(1, '#0a5b8d');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0a5a8a'; ctx.lineWidth = Math.max(1, s * 0.02); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1, s * 0.016);
      ctx.beginPath(); ctx.moveTo(-s * 0.30, -s * 0.10); ctx.lineTo(s * 0.30, -s * 0.10);
      ctx.moveTo(0, -s * 0.34); ctx.lineTo(-s * 0.12, -s * 0.10); ctx.lineTo(0, s * 0.36);
      ctx.moveTo(0, -s * 0.34); ctx.lineTo(s * 0.12, -s * 0.10); ctx.lineTo(0, s * 0.36); ctx.stroke();
      // sparkle
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1, s * 0.022);
      ctx.beginPath(); ctx.moveTo(-s * 0.16, -s * 0.22); ctx.lineTo(-s * 0.08, -s * 0.22);
      ctx.moveTo(-s * 0.12, -s * 0.26); ctx.lineTo(-s * 0.12, -s * 0.18); ctx.stroke();
    },
    // ── digital / LED card machine art ──
    rank: function (ctx, s, sym) {
      var r = (sym && sym.rank) || 'A';
      var hi = sym && sym.tier === 'high', mid = sym && sym.tier === 'mid';
      var col = hi ? '#ffe14a' : mid ? '#7fe0ff' : '#9fb4d8';
      var glow = hi ? 'rgba(255,210,60,0.8)' : mid ? 'rgba(80,200,255,0.7)' : 'rgba(150,180,220,0.5)';
      ctx.font = '900 ' + (s * (r.length > 1 ? 0.5 : 0.66)) + 'px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = glow; ctx.shadowBlur = s * 0.18;
      ctx.fillStyle = col; ctx.fillText(r, 0, -s * 0.02);
      ctx.shadowBlur = 0;
      // inner highlight stroke
      ctx.lineWidth = Math.max(1, s * 0.012); ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.strokeText(r, 0, -s * 0.02);
    },
    suit: function (ctx, s, sym) {
      var suit = (sym && sym.suit) || 'spade';
      var red = suit === 'heart' || suit === 'diamond';
      var col = red ? '#ff4d6d' : '#39c0ff';
      var glow = red ? 'rgba(255,77,109,0.8)' : 'rgba(57,192,255,0.8)';
      ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = s * 0.2; ctx.fillStyle = col;
      var u = s * 0.30;
      ctx.beginPath();
      if (suit === 'spade') {
        ctx.moveTo(0, -u); ctx.bezierCurveTo(u, -u * 0.2, u, u * 0.5, 0, u * 0.6);
        ctx.bezierCurveTo(-u, u * 0.5, -u, -u * 0.2, 0, -u); ctx.closePath(); ctx.fill();
        ctx.fillRect(-u * 0.12, u * 0.3, u * 0.24, u * 0.5);
        ctx.beginPath(); ctx.moveTo(-u * 0.4, u * 0.85); ctx.lineTo(u * 0.4, u * 0.85); ctx.lineTo(0, u * 0.45); ctx.closePath(); ctx.fill();
      } else if (suit === 'heart') {
        ctx.moveTo(0, u * 0.7); ctx.bezierCurveTo(-u * 1.3, -u * 0.3, -u * 0.5, -u, 0, -u * 0.35);
        ctx.bezierCurveTo(u * 0.5, -u, u * 1.3, -u * 0.3, 0, u * 0.7); ctx.closePath(); ctx.fill();
      } else if (suit === 'diamond') {
        ctx.moveTo(0, -u); ctx.lineTo(u * 0.7, 0); ctx.lineTo(0, u); ctx.lineTo(-u * 0.7, 0); ctx.closePath(); ctx.fill();
      } else { // club
        var rr = u * 0.42;
        ctx.arc(0, -u * 0.35, rr, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-u * 0.5, u * 0.18, rr, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(u * 0.5, u * 0.18, rr, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.fillRect(-u * 0.12, 0, u * 0.24, u * 0.7);
        ctx.beginPath(); ctx.moveTo(-u * 0.4, u * 0.85); ctx.lineTo(u * 0.4, u * 0.85); ctx.lineTo(0, u * 0.4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },
    joker: function (ctx, s) {
      // jester: three-point hat with bells over a card-purple plate
      ctx.save();
      ctx.shadowColor = 'rgba(180,80,255,0.85)'; ctx.shadowBlur = s * 0.18;
      // plate
      var pg = ctx.createLinearGradient(0, -s*0.36, 0, s*0.36);
      pg.addColorStop(0,'#2a1a4a'); pg.addColorStop(1,'#140a28');
      ctx.fillStyle = pg;
      roundRect(ctx, -s*0.34, -s*0.34, s*0.68, s*0.68, s*0.12); ctx.fill();
      ctx.shadowBlur = 0;
      // hat (three points) in alternating gold/magenta
      var pts=[[-0.26,-0.06],[-0.08,-0.30],[0.0,-0.06]];
      function lobe(x0,tipx,tipy,x1,col){ ctx.fillStyle=col; ctx.beginPath();
        ctx.moveTo(x0*s,-0.04*s); ctx.quadraticCurveTo(tipx*s,tipy*s, x1*s,-0.04*s); ctx.closePath(); ctx.fill(); }
      lobe(-0.30,-0.34,-0.34,-0.10,'#ffd54a');
      lobe(-0.12,-0.04,-0.40,0.10,'#ff61e6');
      lobe(0.08,0.30,-0.34,0.30,'#5cc6ff');
      // bells
      ctx.fillStyle='#ffe27a';
      [[-0.34,-0.34],[-0.04,-0.42],[0.30,-0.34]].forEach(function(b){ ctx.beginPath(); ctx.arc(b[0]*s,b[1]*s,s*0.045,0,Math.PI*2); ctx.fill(); });
      // hat band
      ctx.fillStyle='#a14dff'; roundRect(ctx,-0.30*s,-0.10*s,0.60*s,0.10*s,s*0.03); ctx.fill();
      // JOKER text
      ctx.fillStyle='#fff'; ctx.font='900 '+(s*0.15)+'px "Arial Black", Impact, sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('JOKER', 0, s*0.20);
      ctx.restore();
    },
    wild: function (ctx, s) {
      // neon WILD diamond plate
      var g = ctx.createLinearGradient(0, -s * 0.36, 0, s * 0.36);
      g.addColorStop(0, '#ff61e6'); g.addColorStop(0.5, '#a14dff'); g.addColorStop(1, '#5a2cff');
      ctx.save(); ctx.shadowColor = 'rgba(180,80,255,0.9)'; ctx.shadowBlur = s * 0.22;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, -s * 0.36); ctx.lineTo(s * 0.34, 0); ctx.lineTo(0, s * 0.36); ctx.lineTo(-s * 0.34, 0); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.font = '900 ' + (s * 0.2) + 'px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText('WILD', 0, s * 0.01); ctx.restore();
    },
    scatter: function (ctx, s) {
      // glowing BONUS coin/star
      ctx.save(); ctx.shadowColor = 'rgba(80,255,180,0.9)'; ctx.shadowBlur = s * 0.24;
      var spikes = 8, oR = s * 0.34, iR = s * 0.16;
      ctx.beginPath();
      for (var i = 0; i < spikes * 2; i++) { var rad = (i % 2 ? iR : oR), a = -Math.PI / 2 + i * Math.PI / spikes; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
      ctx.closePath();
      var g = ctx.createRadialGradient(0, 0, s * 0.03, 0, 0, oR);
      g.addColorStop(0, '#d6ffe9'); g.addColorStop(0.5, '#3df0a0'); g.addColorStop(1, '#11a86a');
      ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#063b27'; ctx.font = '900 ' + (s * 0.13) + 'px "Arial Black", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BONUS', 0, s * 0.01); ctx.restore();
    },
    bell: function (ctx, s) {
      // golden bell with rim, slot + clapper, and a shine sweep
      var g = ctx.createLinearGradient(-s * 0.3, -s * 0.34, s * 0.3, s * 0.32);
      g.addColorStop(0, '#fff3bf'); g.addColorStop(0.4, '#ffd23e'); g.addColorStop(0.75, '#d99a12'); g.addColorStop(1, '#9c6c08');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.34);
      ctx.bezierCurveTo(s * 0.06, -s * 0.34, s * 0.10, -s * 0.30, s * 0.12, -s * 0.22);
      ctx.bezierCurveTo(s * 0.18, -s * 0.04, s * 0.26, s * 0.10, s * 0.32, s * 0.20);
      ctx.lineTo(-s * 0.32, s * 0.20);
      ctx.bezierCurveTo(-s * 0.26, s * 0.10, -s * 0.18, -s * 0.04, -s * 0.12, -s * 0.22);
      ctx.bezierCurveTo(-s * 0.10, -s * 0.30, -s * 0.06, -s * 0.34, 0, -s * 0.34);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9c6c08'; ctx.lineWidth = Math.max(1, s * 0.018); ctx.stroke();
      // rim
      ctx.fillStyle = '#e8b62e'; ctx.strokeStyle = '#8a5f06';
      roundRect(ctx, -s * 0.34, s * 0.20, s * 0.68, s * 0.09, s * 0.04); ctx.fill(); ctx.stroke();
      // top loop
      ctx.lineWidth = Math.max(1, s * 0.035); ctx.strokeStyle = '#c98a12';
      ctx.beginPath(); ctx.arc(0, -s * 0.36, s * 0.05, Math.PI, 0); ctx.stroke();
      // clapper
      ctx.fillStyle = '#8a5f06'; ctx.beginPath(); ctx.arc(0, s * 0.30, s * 0.05, 0, Math.PI * 2); ctx.fill();
      // shine
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.ellipse(-s * 0.10, -s * 0.10, s * 0.05, s * 0.14, -0.3, 0, Math.PI * 2); ctx.fill();
    },
    star: function (ctx, s) {
      // gold 5-point star with BONUS banner
      var spikes = 5, oR = s * 0.34, iR = s * 0.14, rot = -Math.PI / 2;
      ctx.beginPath();
      for (var i = 0; i < spikes * 2; i++) {
        var r = (i % 2 === 0) ? oR : iR, a = rot + i * Math.PI / spikes;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r - s * 0.04);
      }
      ctx.closePath();
      var g = ctx.createRadialGradient(-s * 0.06, -s * 0.14, s * 0.02, 0, 0, oR);
      g.addColorStop(0, '#fff4c0'); g.addColorStop(0.5, '#ffd54a'); g.addColorStop(1, '#c98a12');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#a06b08'; ctx.lineWidth = Math.max(1, s * 0.02); ctx.stroke();
      // banner
      roundRect(ctx, -s * 0.36, s * 0.22, s * 0.72, s * 0.16, s * 0.05);
      ctx.fillStyle = '#b3160b'; ctx.fill();
      ctx.strokeStyle = '#7d1206'; ctx.lineWidth = Math.max(1, s * 0.012); ctx.stroke();
      ctx.fillStyle = '#ffe9a8'; ctx.font = '900 ' + (s * 0.115) + 'px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('BONUS', 0, s * 0.305);
    },
  };

  // Pre-render each symbol: glow halo (premium), drop shadow, art, gloss.
  var PREMIUM = { seven: 'rgba(232,53,24,0.30)', diamond: 'rgba(63,184,232,0.35)', star: 'rgba(255,196,0,0.40)', bell: 'rgba(255,200,40,0.30)', ace: 'rgba(255,210,60,0.3)', wild: 'rgba(180,80,255,0.35)', joker: 'rgba(180,80,255,0.4)', scatter: 'rgba(80,255,180,0.35)', spade:'rgba(57,192,255,0.25)', heart:'rgba(255,77,109,0.25)' };
  var tiles = {};
  function buildTiles(cellPx) {
    tiles = {};
    Object.keys(machine.symbols).forEach(function (id) {
      var c = document.createElement('canvas'); c.width = c.height = cellPx;
      var x = c.getContext('2d');
      x.translate(cellPx / 2, cellPx / 2);
      var sym = machine.symbols[id]; var art = ART[sym.art] || ART.lemon;
      // halo for premium symbols
      if (PREMIUM[id]) {
        var halo = x.createRadialGradient(0, 0, cellPx * 0.05, 0, 0, cellPx * 0.46);
        halo.addColorStop(0, PREMIUM[id]); halo.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = halo; x.fillRect(-cellPx / 2, -cellPx / 2, cellPx, cellPx);
      }
      // drop shadow pass
      x.save();
      x.shadowColor = 'rgba(25,35,55,0.35)';
      x.shadowBlur = cellPx * 0.07;
      x.shadowOffsetY = cellPx * 0.045;
      art(x, cellPx * 0.92, sym);
      x.restore();
      tiles[id] = c;
    });
  }

  // ───────────────────────── reel renderer ─────────────────────────
  var canvas, ctx, DPR = Math.min(window.devicePixelRatio || 1, 2);
  var geo = { cell: 0, w: 0, h: 0, reelW: 0, gap: 0 };
  var reels = [];   // { pos, vel, state, target, settleT, bounce }
  var LINE_COLORS = ['#1f9e5f', '#2f6fb3', '#c8551b', '#9036b3', '#c2272d'];
  var highlight = { wins: [], until: 0 };

  function setupCanvas() {
    canvas = $('reels'); ctx = canvas.getContext('2d');
    var rows = machine.layout.rows, nReels = machine.layout.reels;
    var box = canvas.parentElement;                       // .reelbox — real px from aspect-ratio
    var cs = getComputedStyle(box);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var boxW = box.clientWidth - padX;
    var boxH = box.clientHeight - padY;
    if (boxW < 20 || boxH < 20) return false;             // not laid out yet — caller retries
    geo.gap = Math.max(6, boxW * 0.02);
    geo.reelW = (boxW - geo.gap * (nReels - 1)) / nReels;
    geo.cell = Math.max(30, Math.min(geo.reelW, boxH / rows));
    geo.w = geo.reelW * nReels + geo.gap * (nReels - 1);
    geo.h = geo.cell * rows;
    canvas.width = geo.w * DPR; canvas.height = geo.h * DPR;
    canvas.style.width = geo.w + 'px';
    canvas.style.height = geo.h + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildTiles(Math.floor(geo.cell));
    if (!reels.length) {
      for (var i = 0; i < nReels; i++) reels.push({ pos: i * 3, vel: 0, state: 'idle', target: 0, settleT: 0, bounce: 0 });
    }
    return true;
  }


  /** Cylinder squash: cells near the window's top/bottom edge compress + sit
   * slightly toward center, faking the curve of a physical reel drum. */
  function cylinder(yCenter) {
    var t = (yCenter - geo.h / 2) / (geo.h / 2);          // -1 .. 1
    t = Math.max(-1, Math.min(1, t));
    return { scale: 1 - 0.18 * t * t, shift: -t * t * t * geo.cell * 0.06 };
  }

  function drawReel(r, x) {
    var strip = machine.strips[r], len = strip.length, rows = machine.layout.rows;
    var R = reels[r];
    var pos = R.pos - (R.bounce || 0);
    var base = Math.floor(pos), frac = pos - base;
    var blur = R.state === 'spinning' && Math.abs(R.vel) > 18;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, 0, geo.reelW, geo.h); ctx.clip();
    // drum background: vertical curve shading
    var bgg = ctx.createLinearGradient(0, 0, 0, geo.h);
    bgg.addColorStop(0, '#dde1e8'); bgg.addColorStop(0.18, '#ffffff'); bgg.addColorStop(0.5, '#ffffff');
    bgg.addColorStop(0.82, '#ffffff'); bgg.addColorStop(1, '#d6dae2');
    ctx.fillStyle = bgg; ctx.fillRect(x, 0, geo.reelW, geo.h);
    for (var row = -1; row <= rows; row++) {
      var idx = ((base + row) % len + len) % len;
      var y = (row - frac) * geo.cell;
      var t = tiles[strip[idx]];
      var cyl = cylinder(y + geo.cell / 2);
      var dh = geo.cell * cyl.scale;
      var dy = y + (geo.cell - dh) / 2 + cyl.shift;
      var cx = x + (geo.reelW - geo.cell) / 2;
      if (blur) {
        ctx.globalAlpha = 0.4;
        ctx.drawImage(t, cx, dy - geo.cell * 0.20, geo.cell, dh);
        ctx.drawImage(t, cx, dy + geo.cell * 0.20, geo.cell, dh);
        ctx.globalAlpha = 0.75;
      }
      ctx.drawImage(t, cx, dy, geo.cell, dh);
      ctx.globalAlpha = 1;
    }
    // drum edge shadows (over symbols, under glass)
    var sh = ctx.createLinearGradient(0, 0, 0, geo.h);
    sh.addColorStop(0, 'rgba(20,30,50,0.30)'); sh.addColorStop(0.16, 'rgba(20,30,50,0)');
    sh.addColorStop(0.84, 'rgba(20,30,50,0)'); sh.addColorStop(1, 'rgba(20,30,50,0.30)');
    ctx.fillStyle = sh; ctx.fillRect(x, 0, geo.reelW, geo.h);
    // side shading per reel (cylinder ends)
    var side = ctx.createLinearGradient(x, 0, x + geo.reelW, 0);
    side.addColorStop(0, 'rgba(20,30,50,0.10)'); side.addColorStop(0.08, 'rgba(20,30,50,0)');
    side.addColorStop(0.92, 'rgba(20,30,50,0)'); side.addColorStop(1, 'rgba(20,30,50,0.10)');
    ctx.fillStyle = side; ctx.fillRect(x, 0, geo.reelW, geo.h);
    ctx.restore();
    // divider groove between reels
    if (r > 0) {
      var gx = x - geo.gap / 2;
      ctx.fillStyle = 'rgba(120,130,150,0.35)'; ctx.fillRect(gx - 1, 0, 2, geo.h);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(gx + 1, 0, 1, geo.h);
    }
  }

  function drawPaylineOverlays(now) {
    if (!highlight.wins.length || now > highlight.until) return;
    var pulse = 0.55 + 0.45 * Math.sin(now / 130);
    highlight.wins.forEach(function (w) {
      var color = LINE_COLORS[(w.line - 1) % LINE_COLORS.length];
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = 12 * pulse;
      ctx.strokeStyle = color; ctx.globalAlpha = 0.85 * pulse; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (var r = 0; r < w.rows.length; r++) {
        var x = r * (geo.reelW + geo.gap) + geo.reelW / 2;
        var y = w.rows[r] * geo.cell + geo.cell / 2;
        if (r === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (r = 0; r < w.rows.length; r++) {
        var rx = r * (geo.reelW + geo.gap) + (geo.reelW - geo.cell) / 2;
        var ry = w.rows[r] * geo.cell;
        ctx.globalAlpha = 0.9 * pulse;
        roundRect(ctx, rx + 3, ry + 3, geo.cell - 6, geo.cell - 6, 10);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  // Physics: accelerate → cruise → glide onto target with settle bounce.
  var SPIN_SPEED = 26;
  function tickReels(dt) {
    reels.forEach(function (R, i) {
      var len = machine.strips[i].length;
      if (R.state === 'spinning') {
        R.vel = Math.min(SPIN_SPEED, R.vel + dt * 60);
        R.pos += R.vel * dt;
        R.pos = ((R.pos % len) + len) % len;   // keep pos unwrapped only while gliding to target
      } else if (R.state === 'stopping') {
        var remain = R.target - R.pos;
        if (remain <= 0.02) { R.pos = R.target % len; R.state = 'settle'; R.settleT = 0; R.vel = 0; }
        else { R.vel = Math.max(3.2, Math.min(R.vel, remain * 3.4)); R.pos += R.vel * dt; }
      } else if (R.state === 'settle') {
        R.settleT += dt;
        if (R.settleT >= 0.22) { R.state = 'idle'; R.bounce = 0; }
        else R.bounce = Math.sin(R.settleT / 0.22 * Math.PI) * 0.12 * (1 - R.settleT / 0.22);
      }
    });
  }

  function render(now) {
    if (!geo.w || !geo.h) return;
    ctx.clearRect(0, 0, geo.w, geo.h);
    for (var i = 0; i < reels.length; i++) drawReel(i, i * (geo.reelW + geo.gap));
    drawPaylineOverlays(now);
  }

  var lastT = 0;
  function loop(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
    if (geo.w && reels.length) tickReels(dt);
    render(t);
    requestAnimationFrame(loop);
  }

  function startSpinAnim() {
    SFX.spinStart();
    $('bezel').classList.remove('winlit', 'biglit');
    reels.forEach(function (R) { R.state = 'spinning'; R.vel = 4; });
  }
  function stopSpinAnimAt(stops, done) {
    stops.forEach(function (stop, i) {
      setTimeout(function () {
        var R = reels[i], len = machine.strips[i].length;
        var cur = ((R.pos % len) + len) % len;
        var dist = ((stop - cur) % len + len) % len + len * 2;
        R.target = cur + dist;
        R.pos = cur;
        R.state = 'stopping';
        SFX.reelStop(i);
        if (i === stops.length - 1) {
          var watch = setInterval(function () {
            if (reels.every(function (x) { return x.state === 'idle'; })) { clearInterval(watch); done(); }
          }, 40);
        }
      }, 260 * i);
    });
  }
  function settleReelsGently() {
    reels.forEach(function (R, i) {
      var len = machine.strips[i].length;
      var cur = ((R.pos % len) + len) % len;
      R.target = Math.ceil(cur) + 1; R.pos = cur; R.state = 'stopping';
    });
  }

  // ───────────────────────── controls ─────────────────────────
  function litRow(rowEl, values, format, key) {
    values.forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'lit-btn'; b.innerHTML = format(v) + '<span class="led"></span>'; b.dataset.v = v;
      b.onclick = function () {
        if (spinning || vaultOpen || (freeSpins && freeSpins.remaining > 0)) return;
        sel[key] = v;
        rowEl.querySelectorAll('.lit-btn').forEach(function (x) { x.classList.toggle('lit', Number(x.dataset.v) === v); });
        updateBetReadout();
      };
      rowEl.appendChild(b);
    });
  }
  function buildControls() {
    litRow($('denomRow'), machine.denominations, function (v) { return '🪙' + v + '<small>PER CREDIT</small>'; }, 'denom');
    litRow($('linesRow'), machine.lineOptions, function (v) { return v + '<small>LINE' + (v > 1 ? 'S' : '') + '</small>'; }, 'lines');
    litRow($('betRow'), machine.betLevels, function (v) { return 'x' + v + '<small>BET</small>'; }, 'betLevel');
    sel.denom = machine.denominations[0];
    sel.lines = machine.lineOptions[machine.lineOptions.length - 1];
    sel.betLevel = machine.betLevels[0];
    ['denomRow', 'linesRow', 'betRow'].forEach(function (id, i) {
      var v = [sel.denom, sel.lines, sel.betLevel][i];
      $(id).querySelectorAll('.lit-btn').forEach(function (x) { x.classList.toggle('lit', Number(x.dataset.v) === v); });
    });
    updateBetReadout();
  }
  function bet() { return sel.denom * sel.betLevel * sel.lines; }
  function updateBetReadout() {
    $('roBet').textContent = fmt(bet());
    $('betReadout').textContent = sel.lines + ' lines × ' + sel.betLevel + ' × 🪙' + sel.denom + ' = ' + fmt(bet()) + ' chips per spin';
  }
  function renderShoe(shoe) {
    var el = $('shoeMeter'); if (!el) return;
    if (!shoe) { el.classList.remove('on'); return; }
    el.classList.add('on');
    el.querySelector('.shoe-label').textContent = (shoe.label || 'DEALER SHOE') + ' — collect JOKERS';
    var pct = Math.max(0, Math.min(100, (shoe.count / shoe.fill) * 100));
    el.querySelector('.shoe-fill').style.width = pct + '%';
    el.querySelector('.shoe-count').textContent = shoe.count + ' / ' + shoe.fill;
  }

  function updateMeters() {
    $('chips').textContent = chips == null ? '—' : fmt(chips);
    var net = session.total.won - session.total.wagered;
    $('roSession').textContent = (net >= 0 ? '+' : '') + fmt(net);
    $('roSession').style.color = net >= 0 ? 'var(--green)' : 'var(--accent)';
    var fb = $('fsBanner');
    if (freeSpins && freeSpins.remaining > 0) {
      fb.style.display = 'block';
      fb.textContent = '✦ FREE SPINS — ' + freeSpins.remaining + ' left · wins x' + (freeSpins.multiplier || 1) + ' ✦';
      $('spinBtn').textContent = 'FREE SPIN (' + freeSpins.remaining + ')';
    } else {
      fb.style.display = 'none';
      $('spinBtn').textContent = 'SPIN';
    }
  }

  // ───────────────────────── spin flow ─────────────────────────
  function spin() {
    if (spinning || vaultOpen || !machine) return;
    if (!(freeSpins && freeSpins.remaining > 0) && chips != null && chips < bet()) {
      toast('Not enough chips for that bet — lower the denomination or lines.');
      return;
    }
    spinning = true;
    $('spinBtn').disabled = true;
    $('roWin').textContent = '0'; $('roWin').classList.remove('glow');
    highlight.wins = [];
    startSpinAnim();

    var minAnim = new Promise(function (r) { setTimeout(r, 650); });
    var req = fetch('/api/spin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: MACHINE_SLUG, denom: sel.denom, betLevel: sel.betLevel, lines: sel.lines }),
      credentials: 'same-origin',
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); });

    Promise.all([req, minAnim]).then(function (out) {
      var status = out[0].status, d = out[0].d;
      if (status === 401) { location.href = '/auth/platform'; return; }
      if (status === 409 && d.code === 'BONUS_PENDING') {
        settleReelsGently();
        spinning = false; $('spinBtn').disabled = false;
        openVault(d.pendingPick);
        return;
      }
      if (!d.ok) {
        settleReelsGently();
        toast(d.error || 'Spin failed');
        spinning = false; $('spinBtn').disabled = false;
        return;
      }
      stopSpinAnimAt(d.stops, function () { presentResult(d); });
    }).catch(function () {
      settleReelsGently();
      toast('Connection hiccup — spin not taken.');
      spinning = false; $('spinBtn').disabled = false;
    });
  }

  function presentResult(d) {
    chips = d.chips != null ? d.chips : chips;
    session = d.session || session;
    freeSpins = d.freeSpins;
    if (d.shoe) renderShoe(d.shoe);
    $('roWin').textContent = fmt(d.payout);
    if (d.payout > 0) $('roWin').classList.add('glow');
    updateMeters();

    if (d.payout > 0) {
      var betShown = d.betShown || bet();
      var ratio = betShown ? d.payout / betShown : 0;
      var tier = ratio >= 50 ? 3 : (d.bigWin || ratio >= 5) ? 2 : 1;
      if (ratio >= 50) SFX.jackpot();
      else SFX.win(tier);
      // bell rings on 8:1 or better — more rings the bigger the hit
      if (ratio >= 8) setTimeout(function () { SFX.bell(ratio >= 50 ? 4 : ratio >= 20 ? 3 : 2); }, 180);
    }
    if (d.wins && d.wins.length) {
      highlight.wins = d.wins;
      highlight.until = performance.now() + 3800;
      $('bezel').classList.add(d.bigWin ? 'biglit' : 'winlit');
      setTimeout(function () { $('bezel').classList.remove('winlit'); }, 2600);
    }

    spinning = false;
    $('spinBtn').disabled = false;

    if (d.bonus && d.bonus.type === 'pick') {
      toast('✦ ' + (d.bonus.label || 'BONUS!') + ' ✦');
      setTimeout(function () { openVault(d.pendingPick || { label: d.bonus.label, options: d.bonus.options, bet: d.betShown }); }, 900);
      return;   // vault first; big-win overlay (if any line win) would fight it
    }
    if (d.bonus && d.bonus.type === 'freespins') toast('✦ ' + (d.bonus.label || 'FREE SPINS!') + ' ✦');
    if (d.bigWin) showBigWin(d);
  }

  // ───────────────────────── Diamond Vault (pick bonus) ─────────────────────────
  var vaultConfettiAnim = null;
  function openVault(info) {
    vaultOpen = true;
    $('spinBtn').disabled = true;
    var gems = $('gems'); gems.innerHTML = '';
    $('vaultResult').textContent = '';
    $('vaultSub').textContent = (info && info.label ? info.label + ' — ' : '') + 'one holds the top prize.';
    $('vaultReturns').classList.remove('show');
    $('vaultCollect').style.display = 'none';
    var n = (info && info.options) || 3;
    for (var i = 0; i < n; i++) {
      var g = document.createElement('button');
      g.className = 'gem'; g.dataset.i = i;
      g.innerHTML = '<div class="stone"></div><div class="facets"></div><div class="qmark">?</div>' +
        '<div class="prize"><span class="x"></span><span class="amt"></span></div>';
      g.onclick = pickGem;
      gems.appendChild(g);
    }
    $('vault').classList.add('show');
  }
  function pickGem(e) {
    var gem = e.currentTarget;
    if (gem.classList.contains('revealed') || pickGem._busy) return;
    pickGem._busy = true;
    var choice = Number(gem.dataset.i);
    fetch('/api/bonus/pick', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice: choice }), credentials: 'same-origin',
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (out) {
        pickGem._busy = false;
        var d = out.d;
        if (!d.ok) { toast(d.error || 'Pick failed — try again'); return; }
        chips = d.chips != null ? d.chips : chips;
        session = d.session || session;
        // reveal all gems from the server's committed layout
        var gems = $('gems').querySelectorAll('.gem');
        gems.forEach(function (g, i) {
          var mult = d.prizes[i];
          g.classList.add('revealed');
          g.classList.add(i === d.picked ? 'picked' : 'dud');
          g.querySelector('.x').textContent = mult + 'x';
          g.querySelector('.amt').textContent = i === d.picked ? '+' + fmt(d.amount) : fmt(mult * d.bet);
          g.onclick = null;
        });
        SFX.win(d.bigWin ? 3 : 2);
        $('vaultResult').textContent = 'YOU WON ' + fmt(d.amount) + ' CHIPS  (' + d.mult + 'x bet)';
        var g2 = session.machine, t2 = session.total;
        $('vrSpinX').textContent = fmt(d.amount) + ' (' + d.mult + 'x)';
        $('vrGameX').textContent = pct(g2.won, g2.wagered);
        $('vrSessX').textContent = pct(t2.won, t2.wagered);
        $('vaultReturns').classList.add('show');
        $('vaultCollect').style.display = 'inline-block';
        updateMeters();
        if (d.bigWin) runConfetti('vaultConfetti', function () { return $('vault').classList.contains('show'); });
      })
      .catch(function () { pickGem._busy = false; toast('Connection hiccup — pick again.'); });
  }
  $('vaultCollect') && ($('vaultCollect').onclick = function () {
    $('vault').classList.remove('show');
    vaultOpen = false;
    $('spinBtn').disabled = false;
    if (vaultConfettiAnim) { cancelAnimationFrame(vaultConfettiAnim); vaultConfettiAnim = null; }
    updateMeters();
  });

  // ───────────────────────── big win overlay + confetti ─────────────────────────
  var confettiAnim = null;
  function countUp(el, target, ms, onTick) {
    var start = performance.now(), from = 0;
    function step(now) {
      var k = Math.min(1, (now - start) / ms);
      var eased = 1 - Math.pow(1 - k, 3);              // ease-out cubic
      var v = Math.floor(from + (target - from) * eased);
      el.textContent = fmt(v);
      if (onTick) onTick(k);
      if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
    }
    requestAnimationFrame(step);
  }
  function showBigWin(d) {
    var betShown = d.betShown || bet();
    var spinX = betShown ? (d.payout / betShown) : 0;
    var jackpot = spinX >= 50;
    $('bwTitle').textContent = jackpot ? 'JACKPOT' : 'BIG WIN';
    $('bwSub').textContent = 'CHIPS WON · ' + spinX.toFixed(1) + 'x YOUR BET';
    var g = d.session.machine, t = d.session.total;
    $('bwSpinX').textContent = (spinX * 100).toFixed(0) + '%';
    $('bwGameX').textContent = pct(g.won, g.wagered);
    $('bwSessX').textContent = pct(t.won, t.wagered);
    $('bigwin').classList.add('show');
    // animated count-up with periodic coin ticks
    var dur = jackpot ? 2200 : 1300, lastTick = 0;
    countUp($('bwAmount'), d.payout, dur, function (k) {
      if (k < 1 && performance.now() - lastTick > 90) { lastTick = performance.now(); SFX.coin(); }
    });
    runConfetti('confetti', function () { return $('bigwin').classList.contains('show'); });
  }
  function pct(won, wagered) { return wagered ? ((won / wagered) * 100).toFixed(0) + '%' : '—'; }
  window.Reels = { closeBigWin: function () {
    $('bigwin').classList.remove('show');
    if (confettiAnim) { cancelAnimationFrame(confettiAnim); confettiAnim = null; }
  } };

  function runConfetti(canvasId, activeFn) {
    var c = $(canvasId), x = c.getContext('2d');
    c.width = innerWidth; c.height = innerHeight;
    var colors = ['#ffd54a', '#cd412b', '#1f9e5f', '#2f6fb3', '#9036b3', '#ffffff', '#3fb8e8'];
    var parts = [];
    for (var i = 0; i < 220; i++) {
      parts.push({
        x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.6,
        w: 6 + Math.random() * 7, h: 8 + Math.random() * 10,
        vy: 130 + Math.random() * 220, vx: -60 + Math.random() * 120,
        rot: Math.random() * Math.PI, vr: -4 + Math.random() * 8,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
    var last = performance.now();
    (function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      x.clearRect(0, 0, c.width, c.height);
      parts.forEach(function (p) {
        p.y += p.vy * dt; p.x += p.vx * dt + Math.sin(now / 300 + p.rot) * 0.6; p.rot += p.vr * dt;
        if (p.y > c.height + 30) { p.y = -20; p.x = Math.random() * c.width; }
        x.save(); x.translate(p.x, p.y); x.rotate(p.rot);
        x.fillStyle = p.color; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.sin(p.rot)));
        x.restore();
      });
      var id = requestAnimationFrame(activeFn() ? frame : function () { x.clearRect(0, 0, c.width, c.height); });
      if (canvasId === 'confetti') confettiAnim = id; else vaultConfettiAnim = id;
    })(last);
  }

  // ───────────────────────── the handle ─────────────────────────
  function wireHandle() {
    var handle = $('handle'), track = $('handleTrack'), knob = handle.querySelector('.knob');
    var drag = null, committed = false;
    function trackH() { return track.clientHeight - handle.clientHeight; }
    function setY(y) {
      handle.style.top = y + 'px';
      // knob squashes slightly as it bottoms out, arm tilts into the pull
      var f = y / Math.max(1, trackH());
      if (knob) knob.style.transform = 'scaleY(' + (1 - f * 0.12) + ')';
    }
    function onDown(e) {
      if (spinning || vaultOpen) return;
      handle.style.transition = '';
      drag = { startY: (e.touches ? e.touches[0].clientY : e.clientY) }; committed = false;
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag) return;
      var cy = e.touches ? e.touches[0].clientY : e.clientY;
      var y = Math.max(0, Math.min(trackH(), cy - drag.startY));
      setY(y);
      // commit + fire the moment the player crosses the throw threshold (feels mechanical)
      if (!committed && y > trackH() * 0.78) {
        committed = true;
        if (navigator.vibrate) navigator.vibrate(18);
        releaseAndSpin(true);
      }
      e.preventDefault();
    }
    function onUp() {
      if (!drag) return;
      var y = parseFloat(handle.style.top) || 0;
      var pulled = !committed && y > trackH() * 0.55;
      drag = null;
      if (!committed) releaseAndSpin(pulled);
    }
    function releaseAndSpin(pulled) {
      drag = null;
      // recoil: overshoot up past 0 then settle (spring)
      handle.style.transition = 'top 0.16s cubic-bezier(.3,0,.6,1)';
      setY(0);
      setTimeout(function () {
        handle.style.transition = 'top 0.34s cubic-bezier(.2,2,.3,1)';
        if (knob) knob.style.transform = 'scaleY(1)';
      }, 30);
      setTimeout(function () { handle.style.transition = ''; }, 380);
      if (pulled) { SFX.pull(); spin(); }
    }
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    addEventListener('mousemove', onMove);
    addEventListener('touchmove', onMove, { passive: false });
    addEventListener('mouseup', onUp);
    addEventListener('touchend', onUp);
  }

  // ───────────────────────── paytable & odds modal ─────────────────────────
  function wirePaytable() {
    var btn = $('infoBtn'), modal = $('payModal'); if (!btn || !modal) return;
    btn.onclick = function () { buildPaytable(); modal.classList.add('show'); };
    $('payClose').onclick = function () { modal.classList.remove('show'); };
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('show'); });
  }

  // client-side mirror of the engine's line eval, for an odds estimate
  function evalLineClient(syms) {
    var wild = machine.wild;
    for (var r = 0; r < machine.paytable.length; r++) {
      var rule = machine.paytable[r];
      if (rule.match) { if (rule.match.length === syms.length && rule.match.every(function (x, i) { return x === syms[i]; })) return rule; }
      else if (rule.group) { var n = syms.filter(function (x) { return machine.symbols[x] && machine.symbols[x].group === rule.group; }).length; if (n >= (rule.count || syms.length)) return rule; }
      else if (rule.anyCount) { var c = syms.filter(function (x) { return x === rule.anyCount.symbol; }).length; if (c === rule.anyCount.count) return rule; }
      else if (rule.leftMatch) { var run = 0; for (var i = 0; i < syms.length; i++) { if (syms[i] === rule.leftMatch || (wild && syms[i] === wild)) run++; else break; } if (run >= rule.count) return rule; }
    }
    return null;
  }
  function estimateOdds() {
    // quick Monte-Carlo for hit frequency + bonus trigger rate (uses real strips)
    var N = 40000, lines = machine.lineOptions[machine.lineOptions.length - 1];
    var pls = machine.paylines.slice(0, lines), rows = machine.layout.rows, R = machine.layout.reels;
    var hit = 0, scat = 0, jok = 0;
    var scatSym = machine.bonuses && machine.bonuses[0] && machine.bonuses[0].trigger && machine.bonuses[0].trigger.scatter;
    for (var n = 0; n < N; n++) {
      var win = [];
      for (var r = 0; r < R; r++) { var strip = machine.strips[r], stop = (Math.random() * strip.length) | 0, col = []; for (var rr = 0; rr < rows; rr++) col.push(strip[(stop + rr) % strip.length]); win.push(col); }
      var won = false, sc = 0, jc = 0;
      for (var pr = 0; pr < R; pr++) for (var q = 0; q < rows; q++) { if (scatSym && win[pr][q] === scatSym) sc++; if (machine.collect && win[pr][q] === machine.collect.symbol) jc++; }
      jok += jc;
      if (scatSym && sc >= (machine.bonuses[0].trigger.count || 3)) scat++;
      for (var p = 0; p < pls.length; p++) { var syms = pls[p].rows.map(function (row, reel) { return win[reel][row]; }); if (evalLineClient(syms)) { won = true; break; } }
      if (won) hit++;
    }
    return { hitPct: (hit / N * 100), scatter1in: scat ? Math.round(N / scat) : null, jokerPerSpin: jok / N, lines: lines };
  }

  function buildPaytable() {
    var body = $('payBody'); if (!body) return;
    $('payTitle').textContent = (machine.name || 'PAYTABLE').toUpperCase();
    var html = '';
    // top-line payouts: collapse leftMatch by symbol showing 3/4/5, or match rules
    var bySym = {}, order = [];
    machine.paytable.forEach(function (r) {
      if (r.leftMatch) { if (!bySym[r.leftMatch]) { bySym[r.leftMatch] = {}; order.push(r.leftMatch); } bySym[r.leftMatch][r.count] = r.mult; }
    });
    html += '<div class=\"pay-sec\"><h4>Symbol pays (per line, × line bet)</h4>';
    order.forEach(function (sym) {
      var lab = (machine.symbols[sym] && machine.symbols[sym].label) || sym;
      var p = bySym[sym]; var parts = [5,4,3].filter(function(k){return p[k];}).map(function(k){return k+'×='+p[k];});
      html += '<div class=\"pay-row\"><span class=\"pl\">' + lab + '</span><span class=\"pr\">' + parts.join('  ') + '</span></div>';
    });
    // non-leftMatch rules (combos, exact matches)
    machine.paytable.filter(function(r){return !r.leftMatch;}).forEach(function(r){
      html += '<div class=\"pay-row\"><span class=\"pl\">' + (r.label||'') + '</span><span class=\"pr\">' + (r.mult?(r.mult+'×'):'') + '</span></div>';
    });
    html += '</div>';
    // wild
    if (machine.wild) { var wl = (machine.symbols[machine.wild]&&machine.symbols[machine.wild].label)||machine.wild;
      html += '<div class=\"pay-sec\"><h4>Wild</h4><div class=\"pay-note\">' + wl + ' substitutes for any symbol in a line win.</div></div>'; }
    // bonuses
    if (machine.bonuses && machine.bonuses.length) { html += '<div class=\"pay-sec\"><h4>Bonus</h4>';
      machine.bonuses.forEach(function(b){ var t = b.type==='freespins' ? (b.spins+' free games, wins ×'+(b.multiplier||1)) : (b.label||b.type);
        html += '<div class=\"pay-note\"><b>'+(b.label||'')+'</b><br>'+ (b.trigger&&b.trigger.scatter?('Land '+(b.trigger.count||3)+' '+((machine.symbols[b.trigger.scatter]&&machine.symbols[b.trigger.scatter].label)||'scatter')+' → '+t):t) +'</div>'; });
      html += '</div>'; }
    // dealer shoe collect
    if (machine.collect) { var cs = (machine.symbols[machine.collect.symbol]&&machine.symbols[machine.collect.symbol].label)||machine.collect.symbol;
      html += '<div class=\"pay-sec\"><h4>'+(machine.collect.label||'Collection')+'</h4><div class=\"pay-note\">Every '+cs+' on the board banks a card. Fill '+machine.collect.fill+' → '+(machine.collect.bonus&&machine.collect.bonus.label||'bonus')+'. Progress is saved and persists between sessions until filled.</div></div>'; }
    // odds (computed)
    html += '<div class=\"pay-sec\"><h4>Odds (estimated)</h4><div class=\"pay-note\">Computing…</div></div>';
    body.innerHTML = html;
    // compute odds async so the modal opens instantly
    setTimeout(function () {
      var o = estimateOdds();
      var oddsHtml = '<table class=\"pay-odds\"><tr><td>Any win (per spin, '+o.lines+' lines)</td><td class=\"pr\">'+o.hitPct.toFixed(1)+'%</td></tr>';
      if (o.scatter1in) oddsHtml += '<tr><td>Free-games trigger</td><td class=\"pr\">~1 in '+o.scatter1in+'</td></tr>';
      if (machine.collect) oddsHtml += '<tr><td>'+((machine.symbols[machine.collect.symbol]&&machine.symbols[machine.collect.symbol].label)||'Joker')+'s per spin (avg)</td><td class=\"pr\">'+o.jokerPerSpin.toFixed(2)+'</td></tr>';
      oddsHtml += '</table><div class=\"pay-note\">RTP target ~94–96%. Estimates from a quick simulation; actual results vary.</div>';
      var secs = body.querySelectorAll('.pay-sec'); secs[secs.length-1].innerHTML = '<h4>Odds (estimated)</h4>' + oddsHtml;
    }, 30);
  }

  // ───────────────────────── boot ─────────────────────────
  function boot() {
    fetch('/api/state?machine=' + MACHINE_SLUG, { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (out) {
        if (out.status === 401) { $('gate').style.display = 'flex'; return; }
        var d = out.d;
        machine = d.machine; chips = d.chips; session = d.session; freeSpins = d.freeSpins;
        $('playerName').textContent = d.player.displayName;
        // theme + machine identity from config
        document.body.dataset.theme = machine.theme || 'classic';
        (function () {
          var name = (machine.name || 'REELS').toUpperCase();
          var el = document.querySelector('.m-name');
          if (el) {
            // keep the diamond accent only for classic; digital gets a clean LED title
            el.innerHTML = (machine.theme === 'digital')
              ? name.replace(/s+/g, ' &nbsp; ')
              : name;
          }
          var sub = document.querySelector('.m-sub');
          if (sub) sub.textContent = 'MADLADSLAB · REELS';
          // reel window matches the grid shape (reels:rows)
          var rb = $('reels').parentElement;
          if (rb && machine.layout) rb.style.aspectRatio = machine.layout.reels + ' / ' + machine.layout.rows;
        })();
        buildControls();
        // size the canvas as soon as the reelbox has real dimensions, and on any resize
        var ensured = false;
        function ensureCanvas(){ if (setupCanvas()) { ensured = true; } else { requestAnimationFrame(ensureCanvas); } }
        ensureCanvas();
        if (window.ResizeObserver) {
          var ro = new ResizeObserver(function(){ setupCanvas(); });
          ro.observe($('reels').parentElement);
        }
        updateMeters();
        wireHandle();
        SFX.unlock();
        ['pointerdown','keydown','touchstart'].forEach(function(ev){ addEventListener(ev, function unlock(){ SFX.unlock(); }, { once: false }); });
        $('spinBtn').onclick = function(){ SFX.pull(); spin(); };
        addEventListener('keydown', function (e) { if (e.code === 'Space' && !spinning && !vaultOpen) { e.preventDefault(); spin(); } });
        requestAnimationFrame(loop);
        renderShoe(d.shoe);
        wirePaytable();
        // resume an unfinished bonus (e.g. reloaded mid-pick)
        if (d.pendingPick) openVault(d.pendingPick);
      })
      .catch(function () { toast('Could not reach Reels — try a refresh.'); });
  }
  boot();
})();
