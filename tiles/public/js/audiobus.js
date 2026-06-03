/**
 * audiobus.js — unified audio for the casino tables.
 *
 * A master + per-channel WebAudio mixer (music / crowd / dealer / effects), the
 * Piper dealer voice (via the tiles /tts proxy), synthesized applause+cheer (no
 * asset needed), and looping beds for music / crowd chatter (supply a URL; a
 * missing file just stays silent). A mixer popover mounts on the volume icon and
 * persists levels in localStorage. Resumes the audio context on first gesture.
 */

import { panel } from './casino-ui.js?v=1780413000000';

const LS_KEY = 'casino_mix_v1';
const CHANNELS = [
  { id: 'master',  label: 'Master',  def: 0.9 },
  { id: 'music',   label: 'Music',   def: 0.30 },
  { id: 'chatter', label: 'Crowd',   def: 0.40 },
  { id: 'voice',   label: 'Dealer',  def: 1.0 },
  { id: 'fx',      label: 'Effects', def: 0.7 },
];

export function createAudioBus(opts = {}) {
  const ttsBase = opts.ttsBase || '/tts';
  const voiceName = opts.voice || 'ryan';
  const onMuteChange = opts.onMuteChange || (() => {});

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  const vol = {};
  for (const c of CHANNELS) vol[c.id] = (typeof saved[c.id] === 'number') ? saved[c.id] : c.def;
  let muted = saved.muted === true;

  let ctx = null;
  const gains = {};
  const loops = {};
  function ac() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    gains.master = ctx.createGain(); gains.master.connect(ctx.destination);
    for (const c of CHANNELS) {
      if (c.id === 'master') continue;
      gains[c.id] = ctx.createGain(); gains[c.id].connect(gains.master);
    }
    applyVol();
    return ctx;
  }
  function applyVol() {
    if (!ctx) return;
    gains.master.gain.value = muted ? 0 : vol.master;
    for (const c of CHANNELS) if (c.id !== 'master' && gains[c.id]) gains[c.id].gain.value = vol[c.id];
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ ...vol, muted })); } catch (e) {} }
  function resume() { try { ac().resume(); } catch (e) {} }

  // --- dealer voice (Piper via tiles proxy); latest call wins ---
  let _voiceEl = null;
  function speak(text) {
    if (!text || muted) return;
    resume();
    try {
      if (!_voiceEl) {
        _voiceEl = new Audio(); _voiceEl.crossOrigin = 'anonymous';
        ac().createMediaElementSource(_voiceEl).connect(gains.voice);
      }
      _voiceEl.src = ttsBase + '?voice=' + encodeURIComponent(voiceName) + '&text=' + encodeURIComponent(text);
      _voiceEl.play().catch(() => {});
    } catch (e) {}
  }

  // --- looping beds: music / crowd chatter from a URL (silent if it 404s) ---
  function playLoop(channel, url) {
    if (!url || !CHANNELS.some((c) => c.id === channel)) return;
    resume();
    try {
      const el = new Audio(); el.loop = true; el.crossOrigin = 'anonymous'; el.preload = 'auto'; el.src = url;
      ac().createMediaElementSource(el).connect(gains[channel]);
      el.play().catch(() => {});
      loops[channel] = el;
    } catch (e) {}
  }
  function stopLoop(channel) { const el = loops[channel]; if (el) { try { el.pause(); } catch (e) {} } }

  // --- synthesized applause + cheer (no asset required) ---
  function applause(dur = 2.2) {
    if (muted) return;
    resume();
    const a = ac(), out = gains.fx, now = a.currentTime;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;          // white-noise crowd bed
    const noise = a.createBufferSource(); noise.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.5;
    const ng = a.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(0.55, now + 0.22);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(bp); bp.connect(ng); ng.connect(out);
    noise.start(now); noise.stop(now + dur);
    for (let i = 0; i < 3; i++) {                                        // a few cheer whoops
      const o = a.createOscillator(), g = a.createGain(), t = now + 0.08 + i * 0.17;
      o.type = 'triangle';
      o.frequency.setValueAtTime(360 + i * 70, t);
      o.frequency.exponentialRampToValueAtTime(720 + i * 90, t + 0.18);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
    }
  }

  // --- generative ambient beds (no asset needed): a soft pad + room murmur ---
  let _bedsOn = false;
  async function tryFile(url) { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (e) { return false; } }
  function startBeds() {
    if (_bedsOn) return; _bedsOn = true; resume();
    // Prefer a real royalty-free track if one has been dropped into public/audio;
    // otherwise fall back to the fully-synthesized swing bed (no asset, no license).
    tryFile('/static/audio/music.mp3').then((ok) => { if (!_bedsOn) return; if (ok) playLoop('music', '/static/audio/music.mp3'); else swingBed(); });
    tryFile('/static/audio/crowd.mp3').then((ok) => { if (!_bedsOn) return; if (ok) playLoop('chatter', '/static/audio/crowd.mp3'); else chatterBed(); });
  }
  // generative "supper-club" swing bed (no asset): walking upright bass + brushed
  // swing ride + sparse muted-brass stabs. Kept sparse + low so it sits under play.
  function swingBed() {
    const a = ac(), out = gains.music;
    const BPM = 108, beat = 60 / BPM, swing = 0.62;
    const roots = [
      [110.00, 123.47, 130.81, 146.83],
      [164.81, 146.83, 138.59, 123.47],
      [110.00, 130.81, 164.81, 220.00],
      [185.00, 164.81, 146.83, 138.59],
    ];
    let bar = 0;
    function brush(t, accent) {
      const len = Math.floor(a.sampleRate * 0.05), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource(); src.buffer = buf;
      const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      const g = a.createGain(); g.gain.setValueAtTime(accent ? 0.05 : 0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      src.connect(hp); hp.connect(g); g.connect(out); src.start(t); src.stop(t + 0.09);
    }
    function bass(t, f) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + beat);
    }
    function stab(t, f) {
      [1, 1.26, 1.5].forEach((r) => {
        const o = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f * r * 2; lp.type = 'lowpass'; lp.frequency.value = 1600;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.55);
      });
    }
    (function loopBar() {
      if (!_bedsOn) return;
      const t0 = a.currentTime + 0.05, walk = roots[bar % roots.length];
      for (let b = 0; b < 4; b++) {
        const tb = t0 + b * beat;
        bass(tb, walk[b]); brush(tb, true); brush(tb + beat * swing, false);
      }
      if (bar % 2 === 1) stab(t0 + beat * 3.5, walk[0]);
      bar++; setTimeout(loopBar, beat * 4 * 1000);
    })();
  }
  function chatterBed() {
    const a = ac(), out = gains.chatter;
    const len = Math.floor(a.sampleRate * 4);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.5) * 0.96; d[i] = last; }  // brown-ish noise
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.7;
    const g = a.createGain(); g.gain.value = 0.5;
    const lfo = a.createOscillator(), lg = a.createGain();   // slow murmur wobble
    lfo.frequency.value = 0.3; lg.gain.value = 0.25;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(bp); bp.connect(g); g.connect(out); src.start();
  }

  // --- mixer popover mounted on a button (the volume icon) ---
  let _panel = null;
  function paintBtn(btn) { if (btn) btn.textContent = muted ? '\ud83d\udd07' : '\ud83d\udd0a'; }
  function buildMixer(btn) {
    if (!btn) return;
    btn.onclick = (e) => { e.stopPropagation(); resume(); toggle(btn); };
    paintBtn(btn);
  }
  function toggle(btn) {
    ensurePanel(btn);
    _panel.style.display = (_panel.style.display === 'none') ? 'block' : 'none';
  }
  function ensurePanel(btn) {
    if (_panel) return _panel;
    const p = panel({ id: 'mixerPanel', place: { top: '54px', right: '10px' }, z: 140,
      accent: 'rgba(227,197,103,.5)', minWidth: '212px', dismissable: true, anchor: btn }).el;
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
    const title = document.createElement('div');
    title.textContent = 'SOUND'; title.style.cssText = 'color:#e3c567;font-weight:800;font-size:12px;letter-spacing:.1em';
    const muteBtn = document.createElement('button');
    muteBtn.style.cssText = 'border:none;border-radius:8px;color:#cfe7d8;padding:4px 12px;font-weight:800;cursor:pointer';
    const paintMute = () => { muteBtn.textContent = muted ? 'Muted' : 'On'; muteBtn.style.background = muted ? '#5a2330' : '#1d3b2b'; };
    muteBtn.onclick = () => { muted = !muted; applyVol(); save(); paintMute(); paintBtn(btn); onMuteChange(muted); };
    paintMute();
    head.appendChild(title); head.appendChild(muteBtn); p.appendChild(head);
    for (const c of CHANNELS) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0';
      const lbl = document.createElement('span'); lbl.textContent = c.label;
      lbl.style.cssText = 'color:#9fb0a6;font-size:12px;width:54px';
      const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = 100;
      sl.value = Math.round(vol[c.id] * 100); sl.style.cssText = 'flex:1;accent-color:#e3c567';
      sl.oninput = () => { vol[c.id] = sl.value / 100; applyVol(); save(); };
      row.appendChild(lbl); row.appendChild(sl); p.appendChild(row);
    }
    _panel = p; return p;
  }

  document.addEventListener('pointerdown', resume, { once: true });

  return {
    speak, applause, playLoop, stopLoop, startBeds, buildMixer, resume,
    setMuted: (m) => { muted = m; applyVol(); save(); }, isMuted: () => muted,
    setVolume: (ch, v) => { if (vol[ch] != null) { vol[ch] = v; applyVol(); save(); } },
  };
}

export default { createAudioBus };
