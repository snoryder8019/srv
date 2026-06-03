/**
 * Procedural GLTF tower generator for Towers (TD).
 *
 * Emits valid, self-contained glTF 2.0 files (geometry + materials embedded as
 * a base64 data-URI buffer) into public/assets/gltf/system/. No external
 * downloads, no texture/licensing concerns - just clean low-poly meshes that
 * three.js GLTFLoader renders out of the box.
 *
 * Run:  node scripts/gen-gltf-towers.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'assets', 'gltf', 'system');

/* ----------------------------- geometry helpers ----------------------------- */
// Each helper appends flat-shaded triangles to a primitive { positions, normals, indices }.

function newPrim() { return { positions: [], normals: [], indices: [] }; }

function pushTri(prim, a, b, c) {
  // flat normal from the triangle plane
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const base = prim.positions.length / 3;
  for (const p of [a, b, c]) { prim.positions.push(p[0], p[1], p[2]); prim.normals.push(nx, ny, nz); }
  prim.indices.push(base, base + 1, base + 2);
}

function pushQuad(prim, a, b, c, d) { pushTri(prim, a, b, c); pushTri(prim, a, c, d); }

function cylinder(prim, { r0, r1, y0, y1, seg = 10, cap = true }) {
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const bl = [c0 * r0, y0, s0 * r0], br = [c1 * r0, y0, s1 * r0];
    const tl = [c0 * r1, y1, s0 * r1], tr = [c1 * r1, y1, s1 * r1];
    pushQuad(prim, bl, br, tr, tl);
    if (cap) {
      pushTri(prim, [0, y1, 0], tl, tr);          // top
      pushTri(prim, [0, y0, 0], br, bl);          // bottom
    }
  }
}

function box(prim, { w, d, y0, y1, cx = 0, cz = 0 }) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  pushQuad(prim, p[4], p[5], p[6], p[7]); // top
  pushQuad(prim, p[3], p[2], p[1], p[0]); // bottom
  pushQuad(prim, p[0], p[1], p[5], p[4]); // -z
  pushQuad(prim, p[2], p[3], p[7], p[6]); // +z
  pushQuad(prim, p[1], p[2], p[6], p[5]); // +x
  pushQuad(prim, p[3], p[0], p[4], p[7]); // -x
}

function crenellations(prim, { r, y0, y1, count = 6 }) {
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    box(prim, { w: 0.22, d: 0.22, y0, y1, cx: Math.cos(t) * r, cz: Math.sin(t) * r });
  }
}

/* ----------------------------- glTF assembler ----------------------------- */

function hexToRgba(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

function buildGltf(name, primSpecs) {
  // primSpecs: [{ prim, color, metallic, roughness, emissive }]
  const chunks = [];     // { bytes:Buffer, target:number } per bufferView
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const meshPrimitives = [];
  let byteOffset = 0;

  const addView = (buf, target) => {
    // pad to 4-byte alignment
    while (byteOffset % 4 !== 0) { chunks.push({ bytes: Buffer.alloc(1) }); byteOffset += 1; }
    const view = { buffer: 0, byteOffset, byteLength: buf.length, target };
    bufferViews.push(view);
    chunks.push({ bytes: buf });
    byteOffset += buf.length;
    return bufferViews.length - 1;
  };

  primSpecs.forEach((spec, idx) => {
    const { prim, color, metallic = 0.2, roughness = 0.7, emissive = '#000000' } = spec;
    const posF = Float32Array.from(prim.positions);
    const norF = Float32Array.from(prim.normals);
    const idxU = Uint16Array.from(prim.indices);

    const posView = addView(Buffer.from(posF.buffer), 34962);
    const norView = addView(Buffer.from(norF.buffer), 34962);
    const idxView = addView(Buffer.from(idxU.buffer.slice(0)), 34963);

    // min/max for POSITION (required by spec)
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < prim.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = prim.positions[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }

    const aPos = accessors.push({ bufferView: posView, componentType: 5126, count: posF.length / 3, type: 'VEC3', min, max }) - 1;
    const aNor = accessors.push({ bufferView: norView, componentType: 5126, count: norF.length / 3, type: 'VEC3' }) - 1;
    const aIdx = accessors.push({ bufferView: idxView, componentType: 5123, count: idxU.length, type: 'SCALAR' }) - 1;

    const em = hexToRgba(emissive);
    const mat = materials.push({
      name: `${name}_mat${idx}`,
      pbrMetallicRoughness: { baseColorFactor: hexToRgba(color), metallicFactor: metallic, roughnessFactor: roughness },
      emissiveFactor: [em[0], em[1], em[2]],
    }) - 1;

    meshPrimitives.push({ attributes: { POSITION: aPos, NORMAL: aNor }, indices: aIdx, material: mat });
  });

  const bin = Buffer.concat(chunks.map(c => c.bytes));
  const gltf = {
    asset: { version: '2.0', generator: 'td-procedural-tower-gen' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: meshPrimitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
  };
  return gltf;
}

/* ----------------------------- tower catalogue ----------------------------- */

function bastion() {
  const base = newPrim(), body = newPrim(), top = newPrim();
  cylinder(base, { r0: 0.85, r1: 0.78, y0: 0, y1: 0.35, seg: 12 });
  cylinder(body, { r0: 0.62, r1: 0.55, y0: 0.35, y1: 1.15, seg: 12 });
  cylinder(top, { r0: 0.7, r1: 0.7, y0: 1.15, y1: 1.35, seg: 12 });
  crenellations(top, { r: 0.6, y0: 1.35, y1: 1.65, count: 7 });
  return buildGltf('Bastion', [
    { prim: base, color: '#3a4252', roughness: 0.9 },
    { prim: body, color: '#4a5568', roughness: 0.8 },
    { prim: top, color: '#5a6478', roughness: 0.75 },
  ]);
}

function arcCoil() {
  const base = newPrim(), body = newPrim(), emitter = newPrim();
  cylinder(base, { r0: 0.8, r1: 0.7, y0: 0, y1: 0.3, seg: 12 });
  cylinder(body, { r0: 0.45, r1: 0.3, y0: 0.3, y1: 1.3, seg: 12 });
  cylinder(emitter, { r0: 0.5, r1: 0.05, y0: 1.3, y1: 1.85, seg: 12 }); // cone-ish emitter
  return buildGltf('ArcCoil', [
    { prim: base, color: '#23303a', roughness: 0.8 },
    { prim: body, color: '#2f5f6e', metallic: 0.5, roughness: 0.4 },
    { prim: emitter, color: '#66e0ff', metallic: 0.3, roughness: 0.2, emissive: '#1c5566' },
  ]);
}

function spire() {
  const base = newPrim(), shaft = newPrim(), crystal = newPrim();
  cylinder(base, { r0: 0.7, r1: 0.6, y0: 0, y1: 0.25, seg: 8 });
  cylinder(shaft, { r0: 0.35, r1: 0.12, y0: 0.25, y1: 1.6, seg: 8 });
  cylinder(crystal, { r0: 0.28, r1: 0.001, y0: 1.6, y1: 2.25, seg: 6 }); // sharp spike
  return buildGltf('Spire', [
    { prim: base, color: '#2a2540', roughness: 0.8 },
    { prim: shaft, color: '#4a3a6e', metallic: 0.4, roughness: 0.5 },
    { prim: crystal, color: '#ff6b9d', metallic: 0.2, roughness: 0.25, emissive: '#5a2540' },
  ]);
}

function bunker() {
  const base = newPrim(), turret = newPrim(), barrel = newPrim();
  box(base, { w: 1.5, d: 1.5, y0: 0, y1: 0.4 });
  box(turret, { w: 0.9, d: 0.9, y0: 0.4, y1: 0.9 });
  cylinder(barrel, { r0: 0.18, r1: 0.18, y0: 0.6, y1: 0.7, seg: 8 }); // stub
  box(barrel, { w: 0.25, d: 0.9, y0: 0.55, y1: 0.75, cz: 0.6 });      // forward barrel
  return buildGltf('Bunker', [
    { prim: base, color: '#33402f', roughness: 0.9 },
    { prim: turret, color: '#46582f', roughness: 0.8 },
    { prim: barrel, color: '#66ff99', metallic: 0.3, roughness: 0.4, emissive: '#1f3a26' },
  ]);
}

/* ----------------------------- write ----------------------------- */

const CATALOG = {
  'bastion.gltf': bastion,
  'arc-coil.gltf': arcCoil,
  'spire.gltf': spire,
  'bunker.gltf': bunker,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const report = [];
for (const [file, fn] of Object.entries(CATALOG)) {
  const gltf = fn();
  const outPath = path.join(OUT_DIR, file);
  fs.writeFileSync(outPath, JSON.stringify(gltf));
  const tris = gltf.meshes[0].primitives.reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0);
  report.push({ file, prims: gltf.meshes[0].primitives.length, tris, bytes: fs.statSync(outPath).size });
}
console.log('Generated GLTF towers in', OUT_DIR);
console.table(report);
