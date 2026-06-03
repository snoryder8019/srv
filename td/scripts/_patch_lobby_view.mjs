import fs from 'fs';
const F = '/srv/td/views/game/lobby.ejs';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('econ-bar')) { console.log('already'); process.exit(0); }

// economy resource bar under the hero (chips/parts/ammo) + a shop in the cache panel
s = s.replace(
  `    </div>
  </section>

  <div class="lobby-grid">`,
  `    </div>
    <div class="econ-bar" id="econ-bar"><span class="muted">Loading supplies…</span></div>
  </section>

  <div class="lobby-grid">`
);

// add buy buttons to the cache panel header
s = s.replace(
  `      <h2>Weapons Cache</h2>
      <div class="cache-tabs">
        <button class="cache-tab active" data-tab="towers">Towers</button>
        <button class="cache-tab" data-tab="cards">Action Cards</button>
      </div>`,
  `      <h2>Weapons Cache</h2>
      <p class="muted">Build defenses from parts, or buy with chips. Ammo arms each deployment in a run.</p>
      <div class="shop-row">
        <button class="btn small" id="buy-parts">🪙 Buy parts pack</button>
        <button class="btn small" id="buy-ammo">🪙 Buy ammo pack</button>
      </div>
      <div class="cache-tabs">
        <button class="cache-tab active" data-tab="towers">Defenses</button>
        <button class="cache-tab" data-tab="cards">Action Cards</button>
      </div>`
);

fs.writeFileSync(F, s);
console.log('lobby.ejs: economy bar + shop buttons added');
