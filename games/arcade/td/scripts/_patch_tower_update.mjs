import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/tower.js';
let s = fs.readFileSync(F, 'utf8');

// Fix the update() refill: iterate entries so we have the id, and refill directly
// on the entity (no broken userData id lookup).
s = s.replace(
  `  // Per-frame: billboard each status bar to face the camera + refill charge.
  update(dt = 0.016) {
    for (const e of this.entities.values()) {
      if (e.bar && this._camera) e.bar.quaternion.copy(this._camera.quaternion);
      if (e.charge < 1) this.setCharge(e.group.userData?.id || '', Math.min(1, e.charge + dt * 1.4));
      // (charge id lookup fallback below)
    }
  }`,
  `  // Per-frame: billboard each status bar to face the camera + refill charge.
  update(dt = 0.016) {
    for (const [id, e] of this.entities.entries()) {
      if (e.bar && this._camera) e.bar.quaternion.copy(this._camera.quaternion);
      if (e.charge < 1) this.setCharge(id, Math.min(1, e.charge + dt * 1.4));
    }
  }`
);

fs.writeFileSync(F, s);
console.log('tower.js: update() refill fixed to iterate by id');
