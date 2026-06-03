/**
 * dealerfx.js — shared dealer feedback for the casino tables.
 *
 * An ambient call-out caption (faint italic text behind the table) + the spoken
 * dealer voice (through a passed-in audio bus), gated to chime on every Nth bet,
 * plus a big-win applause + payout call. Each game supplies callFor(bet) -> the
 * phrase to call. Used by both craps3d and roulette3d so the dealer behaves
 * identically and behaviour changes land in exactly one place.
 *
 *   const DEALER = createDealerFx({ audio: AUDIO, every: 3, callFor });
 *   DEALER.onBet(betEvent);     // counts bets, chimes every Nth
 *   DEALER.bigWin('Winner!');   // applause + spoken call
 */
export function createDealerFx(opts = {}) {
  const audio = opts.audio || null;
  const callFor = opts.callFor || (() => null);
  let _betN = 0, _nextChime = 3 + Math.floor(Math.random() * 4), _capEl = null, _capTimer = null;
  let _rollN = 0, _nextRoll = 5 + Math.floor(Math.random() * 3);   // dealer calls the dice ~every 6th roll

  function ensureCap() {
    if (_capEl) return _capEl;
    const el = document.createElement('div');
    el.id = 'dealer-call';
    el.style.cssText = [
      'position:fixed', 'left:50%', 'top:108px', 'transform:translateX(-50%)',
      'z-index:6', 'pointer-events:none', 'text-align:center', 'max-width:92vw',
      'font-family:Georgia,serif', 'font-style:italic', 'font-weight:700', 'font-size:30px',
      'color:rgba(255,233,168,.92)', 'text-shadow:0 2px 16px rgba(0,0,0,.75)',
      'opacity:0', 'transition:opacity .25s ease', 'letter-spacing:.02em',
    ].join(';');
    document.body.appendChild(el); _capEl = el; return el;
  }
  function showCall(text, speak) {
    if (!text) return;
    const el = ensureCap();
    el.textContent = text;
    el.style.opacity = '0.92';
    if (_capTimer) clearTimeout(_capTimer);
    _capTimer = setTimeout(() => { el.style.opacity = '0'; }, 1700);
    if (speak !== false && audio) { try { audio.speak(text); } catch (e) {} }
  }
  // dealer chimes in on every Nth bet placed at the table
  function onBet(bet) {
    const text = callFor(bet);
    if (!text) return;                          // only count bets the dealer can call
    _betN++;
    if (_betN >= _nextChime) {                  // chime randomly every 3rd-6th call
      _betN = 0; _nextChime = 3 + Math.floor(Math.random() * 4);
      showCall(text);
    }
  }
  // dealer calls the dice on roughly every 6th roll (counts every roll)
  function onRoll(text) {
    if (!text) return;
    _rollN++;
    if (_rollN >= _nextRoll) {
      _rollN = 0; _nextRoll = 5 + Math.floor(Math.random() * 3);
      showCall(text);
    }
  }
  function bigWin(text) {
    if (audio) { try { audio.applause(); } catch (e) {} }
    if (text) showCall(text);
  }

  return { showCall, onBet, onRoll, bigWin };
}

export default { createDealerFx };
