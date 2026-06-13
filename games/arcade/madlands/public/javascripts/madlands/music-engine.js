/**
 * Madlands music engine — a tiny programmatic "DAW".
 * Turns a structured score (from the music agent) into live audio with Tone.js:
 * pad (chords) + bass + lead (chord-tone motif) + drums, looped over the
 * progression. No samples, no audio model — pure synthesis from the brief.
 *
 * score = {
 *   key: "A", mode: "minor",          // tonic + mode (parsed from "A minor" too)
 *   tempo: 88,
 *   progression: ["Am","F","C","G"],   // chord names
 *   groove: "half-time doom funk",     // affects bass/drum feel
 *   leadTimbre: "synth-lyre"
 * }
 *
 * Usage: const p = createPlayer(score); await p.play(); ... p.stop();
 */

const NOTE = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };

function semitone(letter) {
  const k = letter.trim().toUpperCase().replace('♯', '#').replace('♭', 'B');
  return NOTE[k] ?? 0;
}
// chord name -> { root semitone, intervals[] }
function parseChord(name) {
  const m = String(name || '').trim().match(/^([A-Ga-g][#b♯♭]?)(.*)$/);
  if (!m) return { root: 0, intervals: [0, 4, 7] };
  const root = semitone(m[1]);
  const q = m[2].toLowerCase();
  let intervals = [0, 4, 7];
  if (q.startsWith('maj7')) intervals = [0, 4, 7, 11];
  else if (q.startsWith('m7') || q.startsWith('min7')) intervals = [0, 3, 7, 10];
  else if (q.startsWith('7')) intervals = [0, 4, 7, 10];
  else if (q.startsWith('dim')) intervals = [0, 3, 6];
  else if (q.startsWith('aug')) intervals = [0, 4, 8];
  else if (q.startsWith('sus4') || q === 'sus') intervals = [0, 5, 7];
  else if (q.startsWith('sus2')) intervals = [0, 2, 7];
  else if (q.startsWith('m') || q.startsWith('min')) intervals = [0, 3, 7];
  return { root, intervals };
}
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const chordMidi = (c, octave) => c.intervals.map((i) => 12 * (octave + 1) + c.root + i);

// deterministic RNG so a given score always plays the same motif
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let s = h >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function parseKey(score) {
  let mode = (score.mode || '').toLowerCase();
  let key = score.key || 'A';
  const km = String(score.key || '').match(/([A-Ga-g][#b]?)\s*(minor|major|min|maj|m)?/i);
  if (km) { key = km[1]; if (!mode && km[2]) mode = /min|^m$/i.test(km[2]) ? 'minor' : 'major'; }
  return { tonic: key, mode: mode || 'minor' };
}

export function createPlayer(score) {
  const Tone = window.Tone;
  if (!Tone) return { play: async () => alert('audio engine not loaded'), stop() {}, get playing() { return false; } };

  const tempo = Math.max(50, Math.min(200, parseInt(score.tempo || score.tempoBpm, 10) || 90));
  const prog = (Array.isArray(score.progression) ? score.progression : String(score.progression || '').split(/[\n,]+/)).map((s) => s.trim()).filter(Boolean);
  const chords = (prog.length ? prog : ['Am', 'F', 'C', 'G']).map(parseChord);
  const bars = chords.length;
  const groove = String(score.groove || '').toLowerCase();
  const halftime = /half|doom|slow|dirge/.test(groove);
  const rand = rng(JSON.stringify({ p: prog, g: groove, t: tempo }));

  let pad, bass, lead, kick, snare, hat, part, built = false, playing = false;

  function build() {
    pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth' }, envelope: { attack: 0.4, decay: 0.3, sustain: 0.6, release: 1.2 }, volume: -16 }).toDestination();
    bass = new Tone.MonoSynth({ oscillator: { type: 'square' }, filter: { Q: 2, type: 'lowpass' }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 }, filterEnvelope: { attack: 0.01, decay: 0.2, baseFrequency: 120, octaves: 2.5 }, volume: -8 }).toDestination();
    lead = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.18, sustain: 0.2, release: 0.2 }, volume: -12 }).toDestination();
    kick = new Tone.MembraneSynth({ volume: -6 }).toDestination();
    snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: -14 }).toDestination();
    hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 }, volume: -24 }).toDestination();

    const events = [];
    for (let b = 0; b < bars; b++) {
      const c = chords[b];
      // pad: whole-bar chord
      events.push({ time: `${b}:0:0`, type: 'pad', notes: chordMidi(c, 4).map(midiToFreq), dur: '1m' });
      // bass: root, half-time = beats 0&2, else 0..3
      const beats = halftime ? [0, 2] : [0, 1, 2, 3];
      for (const beat of beats) events.push({ time: `${b}:${beat}:0`, type: 'bass', note: midiToFreq(12 * 3 + c.root), dur: halftime ? '2n' : '4n' });
      // lead: chord-tone motif on eighths
      const tones = chordMidi(c, 5);
      for (let i = 0; i < 8; i++) {
        if (rand() < 0.45) continue;
        const n = tones[Math.floor(rand() * tones.length)] + (rand() < 0.2 ? 12 : 0);
        events.push({ time: `${b}:${Math.floor(i / 2)}:${(i % 2) * 2}`, type: 'lead', note: midiToFreq(n), dur: '8n' });
      }
      // drums
      for (const beat of [0, 2]) events.push({ time: `${b}:${beat}:0`, type: 'kick' });
      for (const beat of [1, 3]) events.push({ time: `${b}:${beat}:0`, type: 'snare' });
      for (let i = 0; i < 8; i++) events.push({ time: `${b}:${Math.floor(i / 2)}:${(i % 2) * 2}`, type: 'hat' });
    }

    part = new Tone.Part((time, ev) => {
      if (ev.type === 'pad') pad.triggerAttackRelease(ev.notes, ev.dur, time);
      else if (ev.type === 'bass') bass.triggerAttackRelease(ev.note, ev.dur, time);
      else if (ev.type === 'lead') lead.triggerAttackRelease(ev.note, ev.dur, time);
      else if (ev.type === 'kick') kick.triggerAttackRelease('C1', '8n', time);
      else if (ev.type === 'snare') snare.triggerAttackRelease('16n', time);
      else if (ev.type === 'hat') hat.triggerAttackRelease('32n', time);
    }, events);
    part.loop = true;
    part.loopEnd = `${bars}m`;
    built = true;
  }

  return {
    get playing() { return playing; },
    async play() {
      await Tone.start();
      if (!built) build();
      Tone.Transport.bpm.value = tempo;
      part.start(0);
      Tone.Transport.start();
      playing = true;
    },
    stop() {
      try { Tone.Transport.stop(); part && part.stop(); } catch {}
      playing = false;
    },
    dispose() {
      this.stop();
      [pad, bass, lead, kick, snare, hat, part].forEach((x) => { try { x && x.dispose(); } catch {} });
      built = false;
    },
  };
}

// ---- brief library: varied songs, picked per-zone so places sound different ----
const BRIEFS = [
  { mood: 'doom',    kinds: ['dungeon','building'],            key: 'A',  mode: 'minor', tempo: 72,  groove: 'half-time doom', progression: ['Am','F','Dm','E'] },
  { mood: 'eerie',   kinds: ['dungeon','building'],            key: 'D',  mode: 'minor', tempo: 84,  groove: 'sparse dirge',   progression: ['Dm','Bb','Gm','A'] },
  { mood: 'drift',   kinds: ['space'],                         key: 'E',  mode: 'minor', tempo: 68,  groove: 'slow ambient',   progression: ['Em','C','Am','B'] },
  { mood: 'cosmic',  kinds: ['space'],                         key: 'F#', mode: 'minor', tempo: 76,  groove: 'floating',       progression: ['F#m','D','E','C#m'] },
  { mood: 'martial', kinds: ['ground'],                        key: 'C',  mode: 'minor', tempo: 104, groove: 'driving',        progression: ['Cm','Ab','Eb','G'] },
  { mood: 'march',   kinds: ['ground'],                        key: 'G',  mode: 'minor', tempo: 112, groove: 'march',          progression: ['Gm','Eb','Bb','D'] },
  { mood: 'hopeful', kinds: ['ground','space'],                key: 'D',  mode: 'major', tempo: 96,  groove: 'open',           progression: ['D','A','Bm','G'] },
  { mood: 'tense',   kinds: ['dungeon','ground'],              key: 'B',  mode: 'minor', tempo: 100, groove: 'pulsing',        progression: ['Bm','G','D','F#'] },
  { mood: 'mystic',  kinds: ['building','space'],              key: 'F',  mode: 'minor', tempo: 80,  groove: 'shimmer',        progression: ['Fm','Db','Ab','C'] },
  { mood: 'wander',  kinds: ['dungeon','building','ground','space'], key: 'A', mode: 'major', tempo: 90, groove: 'lilt',      progression: ['A','E','F#m','D'] },
];
function hashSeed(s) { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function briefForSeed(seed, kind) {
  const pool = BRIEFS.filter((b) => !kind || b.kinds.includes(kind));
  const list = pool.length ? pool : BRIEFS;
  const b = list[hashSeed(seed) % list.length];
  return { key: b.key, mode: b.mode, tempo: b.tempo, progression: b.progression.slice(), groove: b.groove, mood: b.mood };
}

export default { createPlayer, parseKey, briefForSeed };
