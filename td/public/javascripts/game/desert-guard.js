/**
 * Desertion guard — intercepts attempts to leave an ACTIVE run (browser/phone
 * back button, the logo, and in-app nav links) and shows an in-character warning:
 * abandoning your post is treason. The player chooses "Fight on" (stay) or
 * "Desert" (leave). Only armed while a run is live (state.runId set, not ended).
 */
import { state } from './state.js';

let active = false;          // is a run currently in progress?
let leaving = false;         // user confirmed desertion — allow navigation
let modal = null;
let pendingHref = null;      // where a nav-link click wanted to go

export function setRunActive(v) { active = !!v; }

function buildModal() {
  if (modal) return;
  const style = document.createElement('style');
  style.textContent = `
    #td-desert { position:fixed; inset:0; z-index:300; display:none; align-items:center; justify-content:center;
      background:rgba(3,5,10,.82); backdrop-filter:blur(4px); padding:20px;
      padding-top:calc(20px + var(--safe-top,0px)); padding-bottom:calc(20px + var(--safe-bottom,0px)); }
    #td-desert.show { display:flex; animation:dF .16s ease-out; }
    @keyframes dF { from{opacity:0} to{opacity:1} }
    #td-desert .d-card { width:min(440px,94vw); background:linear-gradient(180deg,#1a0e0e,#120a0a);
      border:1px solid #5b2230; border-radius:16px; box-shadow:0 18px 60px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,120,120,.15);
      overflow:hidden; }
    #td-desert .d-top { background:linear-gradient(180deg,#3a1116,#220a0d); padding:16px 18px;
      border-bottom:1px solid #5b2230; display:flex; align-items:center; gap:12px; }
    #td-desert .d-seal { font-size:30px; filter:drop-shadow(0 0 6px rgba(255,80,80,.5)); }
    #td-desert .d-head { font-weight:900; letter-spacing:.06em; color:#ff6b6b; font-size:16px; text-transform:uppercase; }
    #td-desert .d-sub { color:#d6a2a2; font-size:11px; letter-spacing:.18em; text-transform:uppercase; margin-top:2px; }
    #td-desert .d-body { padding:16px 18px 6px; color:#f0dada; font-size:14px; line-height:1.5; }
    #td-desert .d-body strong { color:#ff8888; }
    #td-desert .d-acts { display:flex; flex-direction:column; gap:9px; padding:14px 18px calc(18px + var(--safe-bottom,0px)); }
    #td-desert button { border:none; border-radius:11px; padding:14px; font-weight:800; font-size:14px;
      cursor:pointer; touch-action:manipulation; min-height:50px; letter-spacing:.03em; }
    #td-desert .d-stay { background:#33ddff; color:#04121b; }
    #td-desert .d-leave { background:transparent; color:#ff8a8a; border:1px solid #6b2330 !important; }
    #td-desert .d-leave:active { background:#2a0e12; }
  `;
  document.head.appendChild(style);

  modal = document.createElement('div');
  modal.id = 'td-desert';
  modal.innerHTML = `
    <div class="d-card" role="alertdialog" aria-modal="true">
      <div class="d-top">
        <span class="d-seal">⚔️</span>
        <div>
          <div class="d-head">Abandon your post?</div>
          <div class="d-sub">Field Tribunal · Article I</div>
        </div>
      </div>
      <div class="d-body">
        Commander, the core is still under siege. To leave the field now is to
        <strong>abandon your post</strong> — and desertion in the face of the enemy
        is <strong>treason, a capital crime</strong>. Your run will be forfeit.
      </div>
      <div class="d-acts">
        <button class="d-stay">⚔️ Fight on</button>
        <button class="d-leave">🏳️ Desert (forfeit the run)</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('.d-stay').addEventListener('click', dismiss);
  modal.querySelector('.d-leave').addEventListener('click', confirmLeave);
  // tapping the dark backdrop = stay (safe default)
  modal.addEventListener('click', (e) => { if (e.target === modal) dismiss(); });
}

function show() { buildModal(); modal.classList.add('show'); }
function hide() { if (modal) modal.classList.remove('show'); }

function dismiss() {
  hide();
  pendingHref = null;
  // re-arm the history trap so the next back press is caught again
  if (active) history.pushState({ tdGuard: true }, '');
}

function confirmLeave() {
  leaving = true;
  hide();
  if (pendingHref) { window.location.href = pendingHref; return; }
  // back-button path: go back past our sentinel state
  history.back();
}

export function initDesertGuard() {
  buildModal();

  // 1) Browser / phone BACK button. Seed a sentinel history entry; when the user
  //    presses back during an active run, we catch the popstate, re-push, and ask.
  history.pushState({ tdGuard: true }, '');
  window.addEventListener('popstate', () => {
    if (!active || leaving) return;     // not in a run, or already confirmed — let it go
    history.pushState({ tdGuard: true }, '');   // cancel the back nav
    show();
  });

  // 2) In-app nav links (logo + header nav) while a run is active.
  document.addEventListener('click', (e) => {
    if (!active || leaving) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || a.target === '_blank') return;
    // only guard navigations that leave the play page
    if (href.startsWith('/play')) return;
    e.preventDefault();
    pendingHref = href;
    show();
  }, true);

  // 3) Hard browser close / reload — native prompt (can't theme this one).
  window.addEventListener('beforeunload', (e) => {
    if (!active || leaving) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

export default { initDesertGuard, setRunActive };
