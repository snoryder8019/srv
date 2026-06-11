/**
 * story-intro.js — Tutorial 1, the guided first drill.
 * Sólveig (wayfinder) walks a new player through the tier ladder and the first
 * voyage: Cluster → learn to Descend → a living moon's orbit (space skirmish)
 * → drop into the moon base for an interior fight. Fills the holds on start so
 * the player can actually travel. Plays once (localStorage), replayable via the
 * ❔ pill or window.MadlandsIntro.play(). Self-contained; one import (resupply).
 */
import { resupply } from '/js/madlands/vessel.js';

(function () {
  const FLAG = 'madlands.intro.v2';
  const GUIDE = 'SÓLVEIG · wayfinder';

  // Cluster → tiers → moon orbit (space skirmish) → moon base (interior battle)
  const BEATS = [
    { icon: '🌌', text: "Easy, wanderer — you're awake in the deep. This is the Cluster, the widest sky there is. I'm Sólveig, your wayfinder. From here it nests inward: cluster → galaxy → star system → the worlds turning in them. Descend, and each tier opens into the next." },
    { icon: '⬇️', text: "To go inward you Descend (▼): pick a node, drop a tier. Ascend (▲) pulls back out, free. Every drop spends supplies from the holds, lower-left — I've stocked you full to start. Watch them; run a tank dry and we're stranded." },
    { icon: '🌑', text: "Your first mark: a living moon, breathing slow, with an old base clinging to its back. Make for its orbit — but raiders prowl that approach. You'll meet them ship-to-ship out in the black before you can close in." },
    { icon: '⚔️', text: "Break through, then Descend again — down onto the moon base itself. Inside it's close quarters: move into the hostiles to strike them, and don't let them corner you. Your hull is all you've got — lose it and the run ends. That's the roguelike of it." },
    { icon: '🎯', text: "So — Tutorial One, your first voyage: Cluster ▸ the living moon's orbit ▸ its base. Win the skirmish, take the base, and you're truly underway. Descend when you're ready, wanderer." },
  ];
  const QUEST = '✦ Tutorial 1 — Descend to the living moon: win the orbit skirmish, then take the moon base.';

  function css() {
    if (document.getElementById('story-css')) return;
    const s = document.createElement('style'); s.id = 'story-css';
    s.textContent = `
    .story-ov{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;
      background:rgba(6,5,14,.66);backdrop-filter:blur(3px);opacity:0;transition:opacity .25s ease}
    .story-ov.on{opacity:1}
    .story-card{max-width:520px;width:calc(100% - 36px);background:linear-gradient(180deg,#171128,#120d20);
      border:1px solid #3a2150;border-radius:16px;padding:20px 22px 16px;color:#e9e4f7;
      font:500 15px/1.5 system-ui,sans-serif;box-shadow:0 24px 70px rgba(0,0,0,.6);transform:translateY(8px);transition:transform .25s ease}
    .story-ov.on .story-card{transform:none}
    .story-hd{display:flex;align-items:center;gap:12px;margin-bottom:12px}
    .story-ic{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:24px;
      background:radial-gradient(circle at 35% 30%,#3a2860,#1c1430);border:1px solid #4a2f72;background-size:cover;background-position:center}
    .story-who{font:700 12px/1.2 'JetBrains Mono',monospace;letter-spacing:.08em;color:#9ad0ff;text-transform:uppercase}
    .story-tx{min-height:104px}
    .story-ft{display:flex;align-items:center;justify-content:space-between;margin-top:14px}
    .story-dots{display:flex;gap:6px}
    .story-dots i{width:7px;height:7px;border-radius:50%;background:#3a2150;transition:background .2s}
    .story-dots i.on{background:#9ad0ff}
    .story-btns{display:flex;gap:8px}
    .story-b{cursor:pointer;border:1px solid #5a4a82;background:#221a3a;color:#e7e3f5;padding:8px 16px;border-radius:999px;font:600 13px system-ui}
    .story-b.skip{background:transparent;border-color:#332a4a;color:#9b90b6}
    .story-b.go:hover{background:#2e2350}
    .story-pill{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;
      background:rgba(12,10,22,.92);border:1px solid #3a2150;border-radius:999px;padding:7px 8px 7px 14px;color:#e7e3f5;
      font:600 12px/1 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.45);max-width:calc(100% - 24px)}
    .story-pill span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .story-pill button{cursor:pointer;border:1px solid #5a4a82;background:#221a3a;color:#cfe6ff;width:24px;height:24px;border-radius:50%;font-size:13px;flex:0 0 auto}`;
    document.head.appendChild(s);
  }

  let i = 0, ov = null;

  function showQuestPill() {
    if (document.querySelector('.story-pill')) return;
    const p = document.createElement('div'); p.className = 'story-pill';
    p.innerHTML = `<span>${QUEST}</span><button title="replay the intro">❔</button>`;
    p.querySelector('button').onclick = () => play();
    document.body.appendChild(p);
  }

  function renderBeat() {
    const b = BEATS[i];
    const ic = ov.querySelector('.story-ic');
    // portrait support: if /assets/img/story/<n>.png exists it'll show; emoji is the fallback
    ic.textContent = b.img ? '' : b.icon;
    ic.style.backgroundImage = b.img ? `url(${b.img})` : '';
    ov.querySelector('.story-tx').textContent = b.text;
    ov.querySelectorAll('.story-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
    ov.querySelector('.story-b.go').textContent = i === BEATS.length - 1 ? 'Begin ▸' : 'Next ▸';
  }

  function close(done) {
    if (!ov) return;
    ov.classList.remove('on');
    setTimeout(() => { ov && ov.remove(); ov = null; }, 250);
    try { localStorage.setItem(FLAG, '1'); } catch (e) {}
    if (done) showQuestPill();
  }

  function play() {
    css(); i = 0;
    try { resupply(); } catch (e) {}   // stock the holds so the first voyage is possible
    if (ov) ov.remove();
    ov = document.createElement('div'); ov.className = 'story-ov';
    ov.innerHTML =
      `<div class="story-card">
         <div class="story-hd"><div class="story-ic"></div><div class="story-who">${GUIDE}</div></div>
         <div class="story-tx"></div>
         <div class="story-ft">
           <div class="story-dots">${BEATS.map(() => '<i></i>').join('')}</div>
           <div class="story-btns"><button class="story-b skip">Skip</button><button class="story-b go"></button></div>
         </div>
       </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('on'));
    renderBeat();
    ov.querySelector('.story-b.skip').onclick = () => close(true);
    ov.querySelector('.story-b.go').onclick = () => { if (i < BEATS.length - 1) { i++; renderBeat(); } else { close(true); } };
  }

  function maybeAutoplay() {
    let seen = null; try { seen = localStorage.getItem(FLAG); } catch (e) {}
    if (seen) { showQuestPill(); return; }
    setTimeout(play, 600);
  }

  window.MadlandsIntro = { play, reset() { try { localStorage.removeItem(FLAG); } catch (e) {} } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeAutoplay);
  else maybeAutoplay();
})();
