/**
 * scaffold3d.js — generic 3D client for PROVISIONED scaffold variants
 * (euchre, mahjong, craps, roulette). It renders the SHARED table core
 * (table3d.js) with the variant's SD scene backdrop and a ring of seats, plus a
 * "scaffold / rules pending" badge. No game protocol yet — when a variant gets
 * real rules, clone hearts3d.js (socket + render) and point /lobby/<game> at it.
 *
 * The game id comes from the path: /lobby/<game>.
 */
import { createTable3D } from './table3d.js';

const seg = location.pathname.split('/').filter(Boolean);
const game = (seg[seg.length - 1] || 'tiles').toLowerCase();
const titled = game.charAt(0).toUpperCase() + game.slice(1);

const statusEl = document.getElementById('status');
const badgeEl = document.getElementById('badge');
if (statusEl) statusEl.innerHTML = `<b>${titled}</b> · scaffold`;

// Shared table core + this variant's pinned, cover-fit SD backdrop.
const T = createTable3D({ tableRadius: 34, bgScene: game });

// Seat plates: start with a sensible default, then correct from the catalog.
let seats = 4;
function drawSeats(n) {
  T.buildSeats(n, 0);
  for (let i = 0; i < n; i++) T.updateSeat(i, { name: `Seat ${i + 1}`, sub: i === 0 ? 'you' : 'bot', you: i === 0 });
}
drawSeats(seats);

fetch('/catalog')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    const g = d && d.games && d.games.find((x) => x.id === game);
    if (!g) { if (badgeEl) badgeEl.innerHTML = `${titled} — scaffold<small>rules pending</small>`; return; }
    seats = (g.seating && g.seating.seats) || g.players || 4;
    drawSeats(seats);
    if (statusEl) statusEl.innerHTML = `<b>${g.name}</b> · scaffold`;
    if (badgeEl) {
      badgeEl.innerHTML =
        `${g.name} — scaffold` +
        `<small>${g.blurb || ''}</small>` +
        `<small>${seats} seats · ${g.status || 'beta'} · rules pending</small>`;
    }
    document.title = `${g.name} 3D · tiles.madladslab`;
  })
  .catch(() => { if (badgeEl) badgeEl.innerHTML = `${titled} — scaffold<small>rules pending</small>`; });

// HUD buttons (shared core API).
document.getElementById('resetcam')?.addEventListener('click', () => T.resetCamera());
let muted = false;
const muteBtn = document.getElementById('mutebtn');
muteBtn?.addEventListener('click', () => { muted = !muted; T.Sound.setMuted(muted); muteBtn.textContent = muted ? '🔇' : '🔊'; });
