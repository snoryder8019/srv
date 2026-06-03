/**
 * Narrative modal — pops a cinematic dialogue card when the server fires a
 * `story:beat`. Shows the speaker's SD "headset" portrait, name + role, and
 * advances through the beat's lines on tap / Space / Enter. When the beat
 * requested a pause, the wave loop is halted server-side until we emit
 * `story:dismiss` on the final line.
 *
 * Self-contained: builds its own DOM + styles once, queues beats so two beats
 * firing together don't clobber each other.
 */
import { socket } from './net.js';
import { state } from './state.js';

let el, portraitEl, nameEl, roleEl, lineEl, hintEl, nextBtn;
let queue = [];
let active = null;       // { beat, lineIdx }
let built = false;

function build() {
  if (built) return; built = true;
  const style = document.createElement('style');
  style.textContent = `
    #td-narrative { position:fixed; inset:0; z-index:200; display:none; align-items:flex-end;
      justify-content:center; background:rgba(2,4,8,.55); backdrop-filter:blur(2px); padding:0 0 6vh; }
    #td-narrative.show { display:flex; animation:tdNarFade .18s ease-out; }
    @keyframes tdNarFade { from{opacity:0} to{opacity:1} }
    #td-narrative .card { width:min(680px,94vw); display:flex; gap:0; background:linear-gradient(180deg,#0d1622,#0a0f17);
      border:1px solid #1d3b52; border-radius:16px; box-shadow:0 24px 80px rgba(0,0,0,.7); overflow:hidden; }
    #td-narrative .portrait { width:140px; min-width:140px; background:#060a10; position:relative; }
    #td-narrative .portrait img { width:100%; height:100%; object-fit:cover; display:block; }
    #td-narrative .portrait .frame { position:absolute; inset:0; box-shadow:inset 0 0 0 2px var(--accent,#33ddff);
      mix-blend-mode:screen; pointer-events:none; }
    #td-narrative .portrait .scan { position:absolute; inset:0; background:repeating-linear-gradient(
      0deg, rgba(51,221,255,.05) 0 2px, transparent 2px 4px); pointer-events:none; }
    #td-narrative .body { flex:1; padding:16px 18px 14px; display:flex; flex-direction:column; min-height:148px; }
    #td-narrative .nm { font-weight:800; letter-spacing:.06em; color:var(--accent,#33ddff); font-size:15px; }
    #td-narrative .rl { color:#7f96a8; font-size:11px; text-transform:uppercase; letter-spacing:.12em; margin-bottom:8px; }
    #td-narrative .ln { color:#e8f1f7; font-size:15.5px; line-height:1.5; flex:1; }
    #td-narrative .ft { display:flex; align-items:center; justify-content:space-between; margin-top:10px; }
    #td-narrative .hint { color:#5f7488; font-size:11px; }
    #td-narrative .next { background:var(--accent,#33ddff); color:#04121b; border:none; border-radius:9px;
      padding:9px 18px; font-weight:800; cursor:pointer; font-size:13px; }
    /* narrative mobile audit: shrink portrait + cap height on small phones */
    @media (max-width: 560px) {
      #td-narrative { padding:0 0 calc(8px + var(--safe-bottom,0px)); }
      #td-narrative .card { width:96vw; }
      #td-narrative .portrait { width:92px; min-width:92px; }
      #td-narrative .body { padding:12px 13px 12px; min-height:120px; }
      #td-narrative .ln { font-size:14.5px; max-height:34vh; overflow-y:auto; -webkit-overflow-scrolling:touch; }
      #td-narrative .nm { font-size:14px; }
    }
  `;
  document.head.appendChild(style);

  el = document.createElement('div');
  el.id = 'td-narrative';
  el.innerHTML = `
    <div class="card">
      <div class="portrait"><img alt=""><div class="scan"></div><div class="frame"></div></div>
      <div class="body">
        <div class="nm"></div><div class="rl"></div>
        <div class="ln"></div>
        <div class="ft"><span class="hint">tap / space to continue</span>
        <button class="next">Continue ▸</button></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  portraitEl = el.querySelector('img');
  nameEl = el.querySelector('.nm');
  roleEl = el.querySelector('.rl');
  lineEl = el.querySelector('.ln');
  hintEl = el.querySelector('.hint');
  nextBtn = el.querySelector('.next');

  const adv = () => advance();
  nextBtn.addEventListener('click', adv);
  el.addEventListener('click', (e) => { if (e.target === el) adv(); });
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); adv(); }
  });
}

function showBeat(beat) {
  active = { beat, lineIdx: 0 };
  const sp = beat.speaker || {};
  el.querySelector('.card').style.setProperty('--accent', sp.color || '#33ddff');
  nameEl.textContent = sp.name || 'Commander';
  roleEl.textContent = sp.role || '';
  portraitEl.src = sp.portraitUrl || '/assets/img/vesk-portrait.png';
  portraitEl.onerror = () => { portraitEl.onerror = null; portraitEl.src = '/assets/img/vesk-portrait.png'; };
  renderLine();
  el.classList.add('show');
}

function renderLine() {
  const { beat, lineIdx } = active;
  lineEl.textContent = beat.lines[lineIdx] || '...';
  const last = lineIdx >= beat.lines.length - 1;
  nextBtn.textContent = last ? 'Continue ▸' : 'Next ▸';
  hintEl.textContent = `${lineIdx + 1}/${beat.lines.length} · tap / space`;
}

function advance() {
  if (!active) return;
  if (active.lineIdx < active.beat.lines.length - 1) { active.lineIdx++; renderLine(); return; }
  // finished this beat
  const beat = active.beat;
  active = null;
  el.classList.remove('show');
  // if the beat paused the loop, tell the server to resume
  if (beat.pause && state.runId) socket.emit('story:dismiss', { runId: state.runId });
  // show the next queued beat, if any
  if (queue.length) showBeat(queue.shift());
}

export function enqueueBeat(beat) {
  build();
  if (active) queue.push(beat);
  else showBeat(beat);
}

export function initNarrative() {
  build();
  socket.on('story:beat', (beat) => enqueueBeat(beat));
}

export default { initNarrative, enqueueBeat };
