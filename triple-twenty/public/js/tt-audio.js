// ═══════════════════════════════════════════════════════════
// Triple-Twenty shared audio module
// Exposes window.ttAudio for use in camera, remote, scoreboard, lobby.
// Keeps WebAudio contexts single-instance per tab.
// ═══════════════════════════════════════════════════════════
(function () {
  if (window.ttAudio) return;

  let _ctx = null;
  let _muted = false;
  // Tabs can override (e.g., scoreboard TV louder than remote phone).
  let _masterGain = 1.0;

  function ensureCtx() {
    if (_ctx) return _ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { _ctx = new Ctx(); } catch (_) { _ctx = null; }
    return _ctx;
  }

  function playTone(freq, durMs = 180, gainPeak = 0.18, type = 'triangle') {
    if (_muted) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    const now  = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const g    = ctx.createGain();
    osc.type   = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gainPeak * _masterGain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);

    const osc2 = ctx.createOscillator();
    const g2   = ctx.createGain();
    osc2.type  = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now);
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(gainPeak * 0.35 * _masterGain, now + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);

    osc.connect(g).connect(ctx.destination);
    osc2.connect(g2).connect(ctx.destination);
    osc.start(now);  osc.stop(now + durMs / 1000 + 0.02);
    osc2.start(now); osc2.stop(now + durMs / 1000 + 0.02);
  }

  // Play a short sequence of notes with gaps.
  // seq: [[freq, durMs, gain], delayMs, [freq, durMs, gain], ...]
  function playSeq(seq) {
    let t = 0;
    for (let i = 0; i < seq.length; i++) {
      const item = seq[i];
      if (typeof item === 'number') { t += item; continue; }
      const [freq, dur, gain] = item;
      setTimeout(() => playTone(freq, dur, gain), t);
    }
  }

  // Equal-temperament reference notes
  const N = {
    C3: 130.81, E3: 164.81, G3: 196.00,
    C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00,
    C6: 1046.50
  };

  // ─── Gameplay sounds ───
  // Solo and multiplayer variants are intentionally distinct so players
  // can tell by ear whether it's their turn vs. general play.
  const sounds = {
    // Dart committed (local input)
    dartCommit:      () => playTone(N.E5, 140, 0.16),

    // AI saw and agreed with user entry
    aiMatch:         () => playSeq([[N.A4, 110, 0.12], 95, [N.E5, 200, 0.16]]),
    // AI saw but disagreed
    aiMismatch:      () => playTone(N.C4, 260, 0.18),
    // AI analysis arrived (distinct from match/mismatch — just "a score was seen")
    aiSeen:          () => playTone(N.B4, 100, 0.11, 'sine'),

    // Round tallied
    roundDoneSolo:   () => playSeq([[N.C5, 90, 0.15], 90, [N.G5, 200, 0.17]]),
    roundDoneMulti:  () => playSeq([[N.G4, 90, 0.14], 80, [N.C5, 90, 0.14], 80, [N.E5, 200, 0.17]]),

    // Socket events (different flavor — short, percussive, easy to distinguish from local)
    yourTurnSolo:    () => playSeq([[N.E5, 120, 0.16], 100, [N.G5, 180, 0.17]]),
    yourTurnMulti:   () => playSeq([[N.C5, 90, 0.14], 80, [N.E5, 90, 0.14], 80, [N.G5, 90, 0.14], 80, [N.C6, 220, 0.18]]),
    opponentScore:   () => playTone(N.D4, 120, 0.10, 'sine'),    // quiet, low — opponent did something
    playerJoined:    () => playSeq([[N.G4, 80, 0.10], 80, [N.C5, 140, 0.12]]),
    playerLeft:      () => playSeq([[N.C5, 100, 0.10], 90, [N.G4, 140, 0.10]]),

    // Game lifecycle
    gameStart:       () => playSeq([[N.C4, 100, 0.13], 100, [N.E4, 100, 0.13], 100, [N.G4, 100, 0.13], 100, [N.C5, 260, 0.18]]),
    gameWinSelf:     () => playSeq([[N.C5, 120, 0.18], 120, [N.E5, 120, 0.18], 120, [N.G5, 120, 0.18], 120, [N.C6, 400, 0.22]]),
    gameWinOther:    () => playSeq([[N.G4, 140, 0.14], 140, [N.E4, 140, 0.14], 140, [N.C4, 320, 0.16]]),
    bust:            () => playSeq([[N.E3, 160, 0.18], 0, [N.C3, 320, 0.20]]),
  };

  // Unlock audio on first user interaction (iOS/Safari requirement).
  // Fires once then removes itself.
  function unlockOnGesture() {
    const kick = () => {
      ensureCtx();
      if (_ctx && _ctx.state === 'suspended') { try { _ctx.resume(); } catch (_) {} }
      ['click', 'touchstart', 'keydown'].forEach(ev =>
        document.removeEventListener(ev, kick, true));
    };
    ['click', 'touchstart', 'keydown'].forEach(ev =>
      document.addEventListener(ev, kick, true));
  }
  unlockOnGesture();

  window.ttAudio = {
    play: (name) => (sounds[name] ? sounds[name]() : null),
    mute: (v) => { _muted = !!v; },
    isMuted: () => _muted,
    setMasterGain: (g) => { _masterGain = Math.max(0, Math.min(2, +g || 0)); },
    sounds: Object.keys(sounds),
    _playTone: playTone  // escape hatch for custom cues
  };
})();
