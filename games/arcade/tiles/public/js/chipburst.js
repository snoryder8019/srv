/**
 * chipburst.js — shared "win celebration" chip burst for every casino game.
 *
 * A ballistic shower of GOLD-skinned chips (SD-generated gold texture, with a
 * procedural gold-gradient fallback if the PNG can't load) that arc up from a
 * point on the felt, tumble, bounce once, and fade. Self-integrates into the
 * table's render loop — callers just spawn.
 *
 *   import { createChipBurst } from './chipburst.js?v=…';
 *   const BURST = createChipBurst(T);
 *   BURST.spawn(x, z, { n: 18 });   // on a win
 *
 * createChipBurst(T, { texUrl })
 *   T      — the table from createTable3D (provides .THREE, .scene, .onFrame)
 *   texUrl — gold texture URL (default '/static/img/gold.png')
 * returns { spawn(x, z, opts), group }
 *   spawn opts: { n=18, color=0xffffff, spread=1.6, power=1, emissive=0x4a3608 }
 */

function proceduralGold(doc) {
  // warm gold gradient + fine sparkle grain — used only if the SD PNG fails
  const S = 256, c = doc.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, S, S);
  g.addColorStop(0.00, '#5a3d0a');
  g.addColorStop(0.22, '#caa23a');
  g.addColorStop(0.48, '#ffe9a8');
  g.addColorStop(0.74, '#c9920f');
  g.addColorStop(1.00, '#7a5512');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    const a = (Math.random() * 0.28).toFixed(2);
    x.fillStyle = `rgba(255,${220 + (Math.random() * 35 | 0)},${150 + (Math.random() * 80 | 0)},${a})`;
    x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 2, 0, 7); x.fill();
  }
  return c;
}

export function createChipBurst(T, opts = {}) {
  const THREE = T.THREE;
  const PARTS = new THREE.Group(); T.scene.add(PARTS);
  const parts = [];
  const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.16, 16);

  // SD gold texture with a graceful procedural fallback
  const loader = new THREE.TextureLoader();
  const goldTex = loader.load(
    opts.texUrl || '/static/img/gold.png',
    undefined, undefined,
    () => { try { goldTex.image = proceduralGold(document); goldTex.needsUpdate = true; } catch (e) {} }
  );
  goldTex.colorSpace = THREE.SRGBColorSpace;
  goldTex.wrapS = goldTex.wrapT = THREE.RepeatWrapping;

  let last = performance.now();

  function spawn(x, z, o = {}) {
    const n = o.n ?? 18;
    const tint = o.color ?? 0xffffff;
    const spread = o.spread ?? 1.6;
    const power = o.power ?? 1;
    const emissive = o.emissive ?? 0x4a3608;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshStandardMaterial({
        map: goldTex, color: tint, emissive, emissiveIntensity: 0.42,
        metalness: 0.3, roughness: 0.38, transparent: true,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x + (Math.random() - 0.5) * spread, 0.5, z + (Math.random() - 0.5) * spread);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      PARTS.add(m);
      const ang = Math.random() * Math.PI * 2, sp = (1.5 + Math.random() * 2.6) * power;
      parts.push({
        mesh: m, vx: Math.cos(ang) * sp, vy: (8 + Math.random() * 6.5) * power, vz: Math.sin(ang) * sp,
        avx: (Math.random() - 0.5) * 12, avy: (Math.random() - 0.5) * 12, avz: (Math.random() - 0.5) * 12,
        life: 0, maxLife: 1.5 + Math.random() * 0.5,
      });
    }
  }

  T.onFrame(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt; p.vy -= 24 * dt;
      const ps = p.mesh.position; ps.x += p.vx * dt; ps.y += p.vy * dt; ps.z += p.vz * dt;
      p.mesh.rotation.x += p.avx * dt; p.mesh.rotation.y += p.avy * dt; p.mesh.rotation.z += p.avz * dt;
      if (ps.y < 0.18) { ps.y = 0.18; p.vy *= -0.42; p.vx *= 0.6; p.vz *= 0.6; }
      p.mesh.material.opacity = p.life > p.maxLife - 0.5 ? Math.max(0, (p.maxLife - p.life) / 0.5) : 1;
      if (p.life >= p.maxLife) { PARTS.remove(p.mesh); p.mesh.material.dispose(); parts.splice(i, 1); }
    }
  });

  return { spawn, group: PARTS };
}

export default { createChipBurst };
