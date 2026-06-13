import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/loot.js';
let s = fs.readFileSync(F, 'utf8');
s = s.replace(
  `      p.mesh.position.y = p.baseY + t * 0.9 * S;          // rise
      p.mesh.material.opacity = 1 - t * t;                 // fade out
      p.mesh.rotation.y += 0.06;                           // spin
      if (this._camera) {
        // keep upright-ish but face camera on Y
        const c = this._camera.position;
        p.mesh.lookAt(c.x, p.mesh.position.y, c.z);
        p.mesh.rotation.y += now * 0.0; // (lookAt already set; spin handled above via rotation.y add pre-lookAt)
      }
      return true;`,
  `      p.mesh.position.y = p.baseY + t * 0.9 * S;          // rise
      p.mesh.material.opacity = 1 - t * t;                 // fade out
      p.mesh.rotation.y += 0.08;                           // spin for readability
      return true;`
);
fs.writeFileSync(F, s);
console.log('loot.js: simplified spin (removed muddled lookAt)');
