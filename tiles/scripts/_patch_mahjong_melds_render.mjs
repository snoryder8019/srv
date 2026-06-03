// add a MELDS group + renderMelds() to mahjong3d.js: exposed claimed sets shown
// face-up just inside each seat, so claims are visible on the table.
import fs from 'fs';
const FILE = '/srv/tiles/public/js/mahjong3d.js';
let s = fs.readFileSync(FILE, 'utf8');

if (s.includes('const MELDS')) { console.log('already has melds renderer'); process.exit(0); }

// 1) add the MELDS group next to OPP
s = s.replace(
  "const OPP = new THREE.Group(); T.scene.add(OPP);       // opponents' concealed rows",
  "const OPP = new THREE.Group(); T.scene.add(OPP);       // opponents' concealed rows\nconst MELDS = new THREE.Group(); T.scene.add(MELDS);   // everyone's exposed claimed melds"
);

// 2) add renderMelds() before renderTable()
const renderMelds = `
// --- exposed melds: small face-up tile groups inside each seat ---
function renderMelds() {
  for (const m of MELDS.children.slice()) MELDS.remove(m);
  const s = C.state; if (!s) return;
  const v = s.view || {};
  const melds = v.melds || [];
  const n = (s.seats || []).length || 4;
  for (let seat = 0; seat < n; seat++) {
    const sets = melds[seat] || []; if (!sets.length) continue;
    const ang = T.seatAngleOf(seat);
    const px = -Math.sin(ang), pz = Math.cos(ang);     // tangent
    const inward = ang + Math.PI;
    const r = T.TABLE_R - 13.5;                          // a ring inside the concealed row
    const flatTiles = [];
    sets.forEach((md) => { md.tiles.forEach((code) => flatTiles.push(code)); flatTiles.push(null); }); // null = gap between melds
    const stepT = (2.6 + 0.18) * 0.52;
    const mid = (flatTiles.length - 1) / 2;
    flatTiles.forEach((code, i) => {
      if (code == null) return;
      const rel = i - mid;
      const cx = Math.cos(ang) * r + px * rel * stepT;
      const cz = Math.sin(ang) * r + pz * rel * stepT;
      const mesh = buildTile(code);
      mesh.position.set(cx, 1.0, cz);
      mesh.rotation.set(Math.PI / 2, inward, 0);        // flat, face up, oriented to the seat
      mesh.scale.setScalar(0.82);
      mesh.userData = { kind: 'meld', seat };
      MELDS.add(mesh);
    });
  }
}

`;
s = s.replace("function renderTable() {", renderMelds + "function renderTable() {");

// 3) call renderMelds() inside renderTable()
s = s.replace(
  "  renderPool();\n  renderRack();\n  renderOpponents();\n}",
  "  renderPool();\n  renderRack();\n  renderOpponents();\n  renderMelds();\n}"
);

// 4) clear MELDS on a new deal (where the other groups are cleared)
s = s.replace(
  "for (const g of [RACK, OPP, POOL]) for (const m of g.children.slice()) g.remove(m);",
  "for (const g of [RACK, OPP, POOL, MELDS]) for (const m of g.children.slice()) g.remove(m);"
);

fs.writeFileSync(FILE, s);
console.log('added renderMelds() to mahjong3d.js');
