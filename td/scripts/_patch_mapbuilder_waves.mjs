import fs from 'fs';
const F = '/srv/td/public/javascripts/builder/map-builder.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('WAVE DESIGNER')) { console.log('already'); process.exit(0); }

// --- wave designer state + rendering, inserted before the Save handler ---
const waveBlock = `
// ───────────────────────── WAVE DESIGNER ─────────────────────────
// Author waves: each wave has enemy groups (type/count/delay) + an optional
// disguised-infiltrator objective (the Where's-Waldo unit). Saved with the map.
const ENEMY_KINDS = ['grunt', 'runner', 'machine', 'flyer', 'basic', 'fast', 'tank'];
const waves = [
  { enemies: [{ type: 'grunt', count: 10, delayMs: 700 }], intermissionMs: 6000, infiltrator: false },
];

function renderWaves() {
  const host = document.getElementById('wd-list');
  if (!host) return;
  host.innerHTML = '';
  waves.forEach((w, wi) => {
    const card = document.createElement('div');
    card.className = 'wd-wave';
    const groups = w.enemies.map((g, gi) => {
      const opts = ENEMY_KINDS.map((k) => '<option value="' + k + '"' + (k === g.type ? ' selected' : '') + '>' + k + '</option>').join('');
      return '<div class="wd-grp" data-gi="' + gi + '">' +
        '<select data-f="type">' + opts + '</select>' +
        '<input data-f="count" type="number" min="1" value="' + g.count + '" title="count">' +
        '<input data-f="delayMs" type="number" min="0" step="50" value="' + g.delayMs + '" title="ms between spawns">' +
        '<button type="button" class="btn small grp-del">✕</button></div>';
    }).join('');
    card.innerHTML =
      '<div class="wd-head"><strong>Wave ' + (wi + 1) + '</strong>' +
        '<button type="button" class="btn small wave-del">✕ wave</button></div>' +
      '<div class="wd-groups">' + groups + '</div>' +
      '<button type="button" class="btn small grp-add">+ enemy group</button>' +
      '<label class="wd-inline">Intermission ms <input data-f="intermissionMs" type="number" min="0" step="500" value="' + w.intermissionMs + '" style="width:80px"></label>' +
      '<label class="wd-inline wd-infil"><input type="checkbox" data-f="infiltrator"' + (w.infiltrator ? ' checked' : '') + '> 🔍 Disguised infiltrator (Where\\'s-Waldo objective)</label>';
    // bindings
    card.querySelector('.wave-del').addEventListener('click', () => { waves.splice(wi, 1); renderWaves(); });
    card.querySelector('.grp-add').addEventListener('click', () => { w.enemies.push({ type: 'grunt', count: 6, delayMs: 600 }); renderWaves(); });
    card.querySelector('[data-f="intermissionMs"]').addEventListener('input', (e) => { w.intermissionMs = Number(e.target.value); });
    card.querySelector('[data-f="infiltrator"]').addEventListener('change', (e) => { w.infiltrator = e.target.checked; });
    card.querySelectorAll('.wd-grp').forEach((row) => {
      const gi = Number(row.dataset.gi);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const f = inp.dataset.f;
          w.enemies[gi][f] = f === 'type' ? inp.value : Number(inp.value);
        });
      });
      row.querySelector('.grp-del').addEventListener('click', () => { w.enemies.splice(gi, 1); if (!w.enemies.length) w.enemies.push({ type: 'grunt', count: 6, delayMs: 600 }); renderWaves(); });
    });
    host.appendChild(card);
  });
}

// build the wave payload: groups as-is + inject one infiltrator group when toggled
function buildWavesPayload() {
  return waves.map((w) => {
    const enemies = w.enemies.map((g) => ({ type: g.type, count: g.count, delayMs: g.delayMs }));
    if (w.infiltrator) enemies.push({ type: 'infiltrator', count: 1, delayMs: 1200 });
    return { enemies, intermissionMs: w.intermissionMs };
  });
}

const wdAdd = document.getElementById('wd-add');
if (wdAdd) wdAdd.addEventListener('click', () => {
  waves.push({ enemies: [{ type: 'grunt', count: 8 + waves.length * 4, delayMs: 600 }], intermissionMs: 6000, infiltrator: false });
  renderWaves();
});
renderWaves();

`;
s = s.replace('// Save\n', waveBlock + '// Save\n');

// include waves in the save payload
s = s.replace(
  `    blockedHexes: collect('blocked'),
  };`,
  `    blockedHexes: collect('blocked'),
    waves: buildWavesPayload(),
  };`
);

fs.writeFileSync(F, s);
console.log('map-builder: wave designer + infiltrator objective wired');
