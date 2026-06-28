/**
 * hud3d.js — SHARED 2D HUD chrome overlaid on every game's 3D table.
 *
 * Owns the table-game chrome that is identical across games: the top status bar
 * (status text + score/info/mute/reset buttons), the lobby ready/add-bot controls,
 * the reconnect banner, the timeout wait/kick vote panel, the scoreboard modal,
 * the game-info modal, and the end-game card. A game supplies only what differs:
 *   • its action controls (renderActions)         — tap-a-card, place-a-bet, roll…
 *   • its info-modal rules copy (infoHTML)         — per-game how-to
 *   • how to read a seat's score/sub line          — scoreFor(view, seat)
 *
 * The HUD expects the host HTML to contain the standard overlay elements (see
 * the shared overlay markup in the game HTML template). It reads live state from
 * the table client passed in.
 *
 *   import { createHUD } from './hud3d.js';
 *   const HUD = createHUD({
 *     client, Sound,
 *     title: 'HEARTS',
 *     renderActions(box, { state, priv, myTurn }) {...},  // fill the #controls box
 *     infoHTML(view) { return '<…>'; },
 *     scoreFor(view, seat) { return { score, sub }; },   // scoreboard + seat plate
 *     scoreLabel: 'Lowest score wins',
 *   });
 *   HUD.render();                  // call on every state/priv change
 *   HUD.showOver(overPayload);     // end-game
 *   HUD.renderVote(vote);
 */
export function createHUD(cfg) {
  const $ = (id) => document.getElementById(id);
  const { client, Sound } = cfg;
  const esc = (x) => { const d = document.createElement('div'); d.textContent = x == null ? '' : String(x); return d.innerHTML; };

  const SUIT_GLYPH = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', H: '♥', D: '♦', C: '♣', S: '♠' };
  const SUIT_RED = { hearts: 1, diamonds: 1, H: 1, D: 1 };
  function suitGlyph(s) { return SUIT_GLYPH[s] || ''; }
  function suitIsRed(s) { return !!SUIT_RED[s]; }

  // ---- trick-game badge strip (trump / lead suit / follow-suit) ----
  // Created dynamically so the per-game HTML shells need no markup. It floats just
  // under the top bar, left-aligned, and is hidden unless a cfg hook supplies a badge.
  let _badgeRow = null;
  function ensureBadgeRow() {
    if (_badgeRow) return _badgeRow;
    if (document.getElementById('hudBadges')) { _badgeRow = document.getElementById('hudBadges'); return _badgeRow; }
    const el = document.createElement('div');
    el.id = 'hudBadges';
    el.style.cssText = 'position:fixed;left:10px;top:58px;z-index:25;display:flex;gap:8px;' +
      'flex-wrap:wrap;pointer-events:none;font:800 13px system-ui;';
    document.body.appendChild(el);
    _badgeRow = el; return el;
  }
  function badgeHTML(b) {
    if (!b || (!b.text && !b.suit)) return '';
    const col = b.color || (suitIsRed(b.suit) ? '#e06b66' : '#e9ecef');
    const g = b.suit ? `<span style="color:${suitIsRed(b.suit) ? '#e06b66' : '#cfe7d8'};font-size:15px">${suitGlyph(b.suit)}</span> ` : '';
    return `<span style="pointer-events:none;background:rgba(8,18,13,.86);border:1px solid rgba(255,255,255,.16);` +
      `color:${col};border-radius:9px;padding:6px 10px;display:inline-flex;align-items:center;gap:4px;` +
      `box-shadow:0 3px 10px rgba(0,0,0,.45)">${g}${esc(b.text || '')}</span>`;
  }
  function renderBadges() {
    const state = client.state; if (!state) { if (_badgeRow) _badgeRow.innerHTML = ''; return; }
    const v = state.view || {};
    const playing = state.phase !== 'lobby' && state.phase !== 'gameOver';
    const parts = [];
    if (playing && cfg.trumpBadge) { const b = cfg.trumpBadge(v); if (b) parts.push(badgeHTML(b)); }
    if (playing && cfg.leadSuitBadge) { const b = cfg.leadSuitBadge(v); if (b) parts.push(badgeHTML(b)); }
    if (playing && cfg.followSuitHint) {
      const b = cfg.followSuitHint(v, client.priv);
      if (b && (b.text || b.suit)) parts.push(badgeHTML({ text: b.text || 'Must follow suit', suit: b.suit, color: b.color || '#ffd9a8' }));
    }
    const row = ensureBadgeRow();
    row.innerHTML = parts.join('');
  }

  // ---- transient trick-winner note (auto-clears) ----
  let _trickNoteTimer = null;
  function showTrickWinner(seatIndex, winnerName) {
    const el = $('status'); if (!el) return;
    const nm = winnerName || (function () { const s = client.state; return (s && s.seats[seatIndex] && (s.seats[seatIndex].displayName)) || ('Seat ' + seatIndex); })();
    el.innerHTML = `<b style="color:var(--gold)">🏆 ${esc(nm)} took the trick</b>`;
    if (cfg.renderTrickWinner) { try { cfg.renderTrickWinner(seatIndex, nm); } catch (e) {} }
    clearTimeout(_trickNoteTimer);
    _trickNoteTimer = setTimeout(() => { setStatus(statusLine()); }, 1500);
  }

  // ---- top bar buttons ----
  if ($('resetcam') && cfg.onResetCam) $('resetcam').onclick = cfg.onResetCam;
  wireMute();
  if ($('scorebtn')) $('scorebtn').onclick = () => openPanel('scorePanel');
  if ($('infobtn')) $('infobtn').onclick = () => openPanel('infoPanel');
  if ($('scoreClose')) $('scoreClose').onclick = () => closePanel('scorePanel');
  if ($('infoClose')) $('infoClose').onclick = () => closePanel('infoPanel');
  [$('scorePanel'), $('infoPanel')].forEach((p) => p && p.addEventListener('click', (e) => { if (e.target === p) p.classList.remove('show'); }));
  if ($('btnRematch')) $('btnRematch').onclick = () => { client.rematch(); $('over').classList.remove('show'); };
  if ($('btnExit')) $('btnExit').onclick = () => location.href = 'https://games.madladslab.com/';
  if ($('voteWait')) $('voteWait').onclick = () => client.vote('wait');
  if ($('voteKick')) $('voteKick').onclick = () => client.vote('kick');

  function openPanel(id) { const e = $(id); if (e) e.classList.add('show'); if (id === 'scorePanel') renderScoreboard(); if (id === 'infoPanel') renderInfo(); }
  function closePanel(id) { const e = $(id); if (e) e.classList.remove('show'); }

  function wireMute() {
    const mb = $('mutebtn'); if (!mb || !Sound) return;
    const paint = () => { mb.textContent = Sound.isMuted() ? '🔇' : '🔊'; }; paint();
    mb.onclick = () => { Sound.setMuted(!Sound.isMuted()); Sound.resume(); if (!Sound.isMuted()) Sound.play(); paint(); try { localStorage.setItem('cards_muted', Sound.isMuted() ? '1' : '0'); } catch (e) {} };
    document.addEventListener('pointerdown', () => Sound.resume(), { once: true });
  }

  // ---- status line ----
  function setStatus(html) { const el = $('status'); if (el) el.innerHTML = html; }
  function statusLine() {
    const state = client.state;
    if (!state) return 'connecting…';
    if (state.phase === 'lobby') return 'Lobby — ready up to start';
    if (state.phase === 'gameOver') return 'Game over';
    if (cfg.statusLine) return cfg.statusLine(state.view || {}, client);
    const v = state.view || {};
    return turnText(v.turn);
  }
  // Prominent, consistent active-turn text. Games can call this from their own
  // statusLine to keep the strong gold styling (instead of plain 'seat N').
  function turnText(turnSeat) {
    if (turnSeat == null) return '';
    if (turnSeat === client.mySeat) return '<b style="color:var(--gold);font-size:1.05em">▶ YOUR TURN</b>';
    const s = client.state;
    const nm = (s && s.seats[turnSeat] && s.seats[turnSeat].displayName) || ('Seat ' + turnSeat);
    return `<b style="color:var(--gold)">${esc(nm)}'s turn</b>`;
  }

  // ---- lobby controls / per-game action controls ----
  function renderControls() {
    const box = $('controls'); if (!box) return; box.innerHTML = '';
    const state = client.state; if (!state) return;
    if (state.phase === 'lobby') {
      const meReady = (state.seats[client.mySeat] || {}).ready;
      // Ready = "I'm good to go" — empty seats now auto-fill with bots once every
      // human present has readied (the old manual "+ Bot seat" buttons are gone).
      const rb = document.createElement('button'); rb.className = 'act'; rb.textContent = meReady ? 'Ready ✓ (filling…)' : 'Ready'; rb.disabled = !!meReady;
      rb.onclick = () => client.ready(); box.appendChild(rb);
      return;
    }
    if (cfg.renderActions) cfg.renderActions(box, { state, priv: client.priv, myTurn: client.myTurn(), $ });
  }

  // ---- scoreboard modal ----
  function renderScoreboard() {
    const body = $('scoreBody'); const state = client.state; if (!body || !state) return;
    const v = state.view || {};
    const seats = state.seats || [];
    const rows = seats.map((s) => {
      const sc = cfg.scoreFor ? cfg.scoreFor(v, s.seat) : { score: 0, sub: '' };
      return { seat: s.seat, name: s.displayName || ('Seat ' + s.seat), bot: s.bot,
        sub: sc.sub, score: sc.score, turn: v.turn === s.seat && state.phase === 'playing', me: s.seat === client.mySeat };
    });
    const lowBest = cfg.lowerWins;
    rows.sort((a, b) => lowBest ? a.score - b.score : b.score - a.score);
    body.innerHTML = rows.map((r) => {
      const cls = ['row', r.me ? 'me' : '', r.turn ? 'turn' : ''].join(' ').trim();
      return `<div class="${cls}">
        <span class="nm">${esc(r.name)} ${r.bot ? '<span class="tag">bot</span>' : ''}${r.me ? '<span class="tag">you</span>' : ''}${r.turn ? '<span class="tag">· turn</span>' : ''}</span>
        <span class="tiles">${esc(r.sub)}</span>
        <span class="pts">${r.score}</span>
      </div>`;
    }).join('');
    if ($('scoreFoot')) $('scoreFoot').textContent = cfg.scoreFootText ? cfg.scoreFootText(v) : (cfg.scoreLabel || '');
  }

  function renderInfo() { const body = $('infoBody'); if (body && cfg.infoHTML) body.innerHTML = cfg.infoHTML((client.state && client.state.view) || {}); }

  // ---- reconnect / vote / end-game ----
  function showReconnect(on, msg, rejoin) {
    const el = $('reconnect'); if (!el) return;
    if (!on) { el.classList.remove('show'); return; }
    el.textContent = msg || 'Reconnecting…';
    if (rejoin) { const b = document.createElement('button'); b.textContent = 'Rejoin'; b.onclick = () => location.href = 'https://match.madladslab.com/resume'; el.appendChild(b); }
    el.classList.add('show');
  }

  function renderVote(vote) {
    const panel = $('votePanel'); if (!panel) return;
    if (!vote || vote.seat == null) { panel.classList.remove('show'); return; }
    const state = client.state;
    const name = (state && state.seats[vote.seat] && state.seats[vote.seat].displayName) || ('Seat ' + vote.seat);
    const iAm = vote.seat === client.mySeat;
    $('voteTitle').textContent = iAm ? 'You timed out — act now or be replaced' : (name + ' is out of time');
    $('voteCount').textContent = iAm ? '' : ('Wait ' + (vote.waits || 0) + ' · Kick ' + (vote.kicks || 0) + ' · of ' + (vote.eligible || 0));
    $('voteWait').style.display = $('voteKick').style.display = iAm ? 'none' : '';
    panel.classList.add('show');
  }

  function showOver(o) {
    const st = (o.standings || []);
    const mine = st.find((x) => x.seat === client.mySeat); const iWon = mine && mine.won;
    if ($('overResult')) $('overResult').textContent = `Game ${o.gamesPlayed} · final`;
    if ($('overTitle')) $('overTitle').textContent = client.mySeat == null ? 'Game Over' : (iWon ? 'You win! 🎉' : 'You lost');
    const lowBest = cfg.lowerWins;
    const best = lowBest ? Math.min(...st.map((x) => x.score ?? 0)) : Math.max(...st.map((x) => x.score ?? 0));
    if ($('overScore')) $('overScore').textContent = (cfg.scoreLabel || '') + ' · ' + best + ' pts';
    if ($('overStand')) $('overStand').innerHTML = st.slice().sort((a, b) => lowBest ? (a.score || 0) - (b.score || 0) : (b.score || 0) - (a.score || 0)).map((s) =>
      `<div class="r"><span>${esc(s.displayName || ('Seat ' + s.seat))}${s.bot ? ' 🤖' : ''}${s.seat === client.mySeat ? ' (you)' : ''}</span>` +
      `<span class="${s.won ? 'w' : 'l'}">${s.score} pts${s.won ? ' · WIN' : ''}</span></div>`).join('');
    if ($('over')) $('over').classList.add('show');
    if (Sound) { iWon ? Sound.win() : Sound.lose(); }
  }
  function hideOver() { if ($('over')) $('over').classList.remove('show'); }

  function render() {
    setStatus(statusLine());
    renderControls();
    renderBadges();
    if ($('scorePanel') && $('scorePanel').classList.contains('show')) renderScoreboard();
  }

  return {
    render, renderVote, showOver, hideOver, showReconnect, setStatus, openPanel, closePanel,
    showTrickWinner, turnText, suitGlyph, renderBadges,
  };
}
