import fs from 'fs';
const F = '/srv/td/public/javascripts/three/entities/enemy.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('showAttackLines')) { console.log('already'); process.exit(0); }

// Add bezier "attack lines" drawn from each enemy to the base/attack point during
// the tactical pause. A quadratic curve that arcs upward, tinted by threat.
s = s.replace(
  `  remove(id) { this._dispose(id); }`,
  `  // ---- Tactical-pause attack lines (bezier arcs enemy -> attack point) ----
  // attackPoint = world {x,z} (the base center). Tint flows green->red by how
  // close the enemy is to the point (closer = more urgent).
  showAttackLines(attackPoint = { x: 0, z: 0 }) {
    this.hideAttackLines();
    this._attackLines = new THREE.Group();
    this._attackLines.renderOrder = 5;
    for (const e of this.entities.values()) {
      if (!e.placed || e.dying) continue;
      const from = new THREE.Vector3(e.root.position.x, TILE_TOP + 0.6 * S, e.root.position.z);
      const to = new THREE.Vector3(attackPoint.x, TILE_TOP + 0.6 * S, attackPoint.z);
      const dist = from.distanceTo(to);
      // control point: midpoint lifted up (arc height scales with distance)
      const mid = from.clone().add(to).multiplyScalar(0.5);
      mid.y += Math.min(8 * S, dist * 0.35);
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const pts = curve.getPoints(24);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      // urgency tint: closer enemies = redder
      const t = Math.max(0, Math.min(1, 1 - dist / (20 * S)));
      const color = new THREE.Color().setHSL(0.33 * (1 - t), 0.9, 0.55);  // green->red
      const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false });
      const line = new THREE.Line(geo, lineMat);
      line.renderOrder = 5;
      this._attackLines.add(line);
      // a small marker pulsing at the attack point end
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12 * S, 8, 6),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      dot.position.copy(from); dot.renderOrder = 6;
      this._attackLines.add(dot);
    }
    this.scene.add(this._attackLines);
  }

  hideAttackLines() {
    if (this._attackLines) {
      this._attackLines.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.scene.remove(this._attackLines);
      this._attackLines = null;
    }
  }

  remove(id) { this._dispose(id); }`
);

fs.writeFileSync(F, s);
console.log('enemy.js: bezier attack lines (showAttackLines/hideAttackLines) added');
