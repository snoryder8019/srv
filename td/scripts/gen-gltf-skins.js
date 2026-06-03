/**
 * gen-gltf-skins.js  -  Per-kind default DEFENDER skins for the siege-kit.
 *
 * skinFor(kind, tower) falls back to a kind's default defender model when a
 * tower has no model of its own. Those four models are referenced by
 * services/siege/skins.js (KIND_THEME[*].defenderGltf) but did not exist. This
 * script generates them procedurally as valid binary glTF 2.0 (.glb) - same
 * dependency-free, no-Blender approach as gen-gltf-towers.js - into:
 *     public/assets/models/skins/{dungeon-turret,building-sentry,
 *                                 ground-turret,space-platform}.glb
 *
 * Contract (same as tower.js): base on y=0, ~square footprint, barrel faces -Z.
 * Run:  node scripts/gen-gltf-skins.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'assets', 'models', 'skins');

/* ----------------------------- geometry ----------------------------- */
function newPrim() { return { positions: [], normals: [], indices: [] }; }
function pushTri(prim, a, b, c) {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
  const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
  const len = Math.hypot(nx, ny, nz) || 1; nx/=len; ny/=len; nz/=len;
  const base = prim.positions.length / 3;
  for (const p of [a, b, c]) { prim.positions.push(p[0], p[1], p[2]); prim.normals.push(nx, ny, nz); }
  prim.indices.push(base, base+1, base+2);
}
function pushQuad(prim, a, b, c, d) { pushTri(prim, a, b, c); pushTri(prim, a, c, d); }

function box(prim, { w, h, d, cx=0, cy=0, cz=0 }) {
  const x0=cx-w/2, x1=cx+w/2, y0=cy-h/2, y1=cy+h/2, z0=cz-d/2, z1=cz+d/2;
  const p=[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
  pushQuad(prim, p[4], p[5], p[6], p[7]);  // top
  pushQuad(prim, p[3], p[2], p[1], p[0]);  // bottom
  pushQuad(prim, p[0], p[1], p[5], p[4]);  // -z
  pushQuad(prim, p[2], p[3], p[7], p[6]);  // +z
  pushQuad(prim, p[1], p[2], p[6], p[5]);  // +x
  pushQuad(prim, p[3], p[0], p[4], p[7]);  // -x
}
function cyl(prim, { r0, r1, y0, y1, seg=12, cap=true }) {
  for (let i=0;i<seg;i++) {
    const t0=(i/seg)*Math.PI*2, t1=((i+1)/seg)*Math.PI*2;
    const c0=Math.cos(t0),s0=Math.sin(t0),c1=Math.cos(t1),s1=Math.sin(t1);
    const bl=[c0*r0,y0,s0*r0], br=[c1*r0,y0,s1*r0], tl=[c0*r1,y1,s0*r1], tr=[c1*r1,y1,s1*r1];
    pushQuad(prim, bl, br, tr, tl);
    if (cap) { pushTri(prim, [0,y1,0], tl, tr); pushTri(prim, [0,y0,0], br, bl); }
  }
}

/* ----------------------------- materials ----------------------------- */
function srgb(hex) {
  const r=((hex>>16)&255)/255, g=((hex>>8)&255)/255, b=(hex&255)/255;
  const L=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
  return [L(r), L(g), L(b)];
}
function bodyMat(hex, { metallic=0.45, rough=0.5 }={}) {
  const [r,g,b]=srgb(hex);
  return { pbrMetallicRoughness:{ baseColorFactor:[r,g,b,1], metallicFactor:metallic, roughnessFactor:rough } };
}
function glowMat(hex) {
  const [r,g,b]=srgb(hex);
  return { pbrMetallicRoughness:{ baseColorFactor:[r,g,b,1], metallicFactor:0, roughnessFactor:0.25 },
           emissiveFactor:[Math.min(1,r),Math.min(1,g),Math.min(1,b)] };
}

/* ----------------------------- GLB writer ----------------------------- */
function buildGLB(name, groups) {
  const views=[], accessors=[], primitives=[], materials=[], chunks=[];
  let offset=0;
  const align=n=>(n+3)&~3;
  function addView(typed, target) {
    const buf=Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    views.push({ buffer:0, byteOffset:offset, byteLength:buf.length, target });
    chunks.push(buf);
    const pad=align(buf.length)-buf.length;
    if (pad) chunks.push(Buffer.alloc(pad));
    offset += buf.length + pad;
    return views.length-1;
  }
  groups.forEach((g, gi) => {
    const pos=new Float32Array(g.prim.positions);
    const nrm=new Float32Array(g.prim.normals);
    const idx=new Uint16Array(g.prim.indices);
    const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
    for (let i=0;i<pos.length;i+=3) for (let k=0;k<3;k++){ const v=pos[i+k]; if(v<min[k])min[k]=v; if(v>max[k])max[k]=v; }
    const vPos=addView(pos,34962), aPos=accessors.length;
    accessors.push({ bufferView:vPos, componentType:5126, count:pos.length/3, type:'VEC3', min, max });
    const vNrm=addView(nrm,34962), aNrm=accessors.length;
    accessors.push({ bufferView:vNrm, componentType:5126, count:nrm.length/3, type:'VEC3' });
    const vIdx=addView(idx,34963), aIdx=accessors.length;
    accessors.push({ bufferView:vIdx, componentType:5123, count:idx.length, type:'SCALAR' });
    primitives.push({ attributes:{ POSITION:aPos, NORMAL:aNrm }, indices:aIdx, material:gi });
    materials.push(g.material);
  });
  const bin=Buffer.concat(chunks);
  const json={ asset:{ version:'2.0', generator:'madlads-skin-gen' }, scene:0, scenes:[{ nodes:[0] }],
    nodes:[{ mesh:0, name }], meshes:[{ name, primitives }], materials, accessors, bufferViews:views,
    buffers:[{ byteLength:bin.length }] };
  let jsonBuf=Buffer.from(JSON.stringify(json),'utf8');
  const jpad=align(jsonBuf.length)-jsonBuf.length; if (jpad) jsonBuf=Buffer.concat([jsonBuf, Buffer.alloc(jpad,0x20)]);
  let binBuf=bin; const bpad=align(binBuf.length)-binBuf.length; if (bpad) binBuf=Buffer.concat([binBuf, Buffer.alloc(bpad,0)]);
  const total=12+8+jsonBuf.length+8+binBuf.length;
  const out=Buffer.alloc(total); let p=0;
  out.writeUInt32LE(0x46546C67,p); p+=4; out.writeUInt32LE(2,p); p+=4; out.writeUInt32LE(total,p); p+=4;
  out.writeUInt32LE(jsonBuf.length,p); p+=4; out.writeUInt32LE(0x4E4F534A,p); p+=4; jsonBuf.copy(out,p); p+=jsonBuf.length;
  out.writeUInt32LE(binBuf.length,p); p+=4; out.writeUInt32LE(0x004E4942,p); p+=4; binBuf.copy(out,p);
  return out;
}

/* ----------------------------- the four skins ----------------------------- */
function groundTurret() {            // amber turret
  const body=newPrim(), glow=newPrim();
  cyl(body,{ r0:0.55,r1:0.5,y0:0,y1:0.22 });
  cyl(body,{ r0:0.45,r1:0.28,y0:0.22,y1:0.55 });
  box(body,{ w:0.14,h:0.14,d:0.55,cy:0.42,cz:-0.42 });   // barrel -Z
  box(glow,{ w:0.1,h:0.08,d:0.08,cy:0.5,cz:-0.18 });     // sight
  return [{ prim:body, material:bodyMat(0xe0a83a) }, { prim:glow, material:glowMat(0xffe08a) }];
}
function dungeonEmplacement() {       // violet hex emplacement
  const body=newPrim(), glow=newPrim();
  cyl(body,{ r0:0.56,r1:0.56,y0:0,y1:0.33,seg:6 });
  cyl(body,{ r0:0.5,r1:0.34,y0:0.33,y1:0.58,seg:6 });
  box(body,{ w:0.16,h:0.16,d:0.5,cy:0.4,cz:-0.42 });     // barrel -Z
  box(glow,{ w:0.18,h:0.06,d:0.18,cy:0.6 });             // rune core
  return [{ prim:body, material:bodyMat(0xb06cff) }, { prim:glow, material:glowMat(0xffd24a) }];
}
function buildingSentry() {           // cyan vertical sentry
  const body=newPrim(), glow=newPrim();
  box(body,{ w:0.46,h:0.95,d:0.46,cy:0.475 });
  box(body,{ w:0.6,h:0.3,d:0.6,cy:1.05 });
  box(body,{ w:0.12,h:0.12,d:0.5,cy:1.05,cz:-0.42 });    // barrel -Z
  box(glow,{ w:0.12,h:0.12,d:0.05,cy:1.05,cz:-0.32 });   // lens
  return [{ prim:body, material:bodyMat(0x6cc8ff) }, { prim:glow, material:glowMat(0xff6c6c) }];
}
function spacePlatform() {            // blue orbital platform
  const body=newPrim(), glow=newPrim();
  cyl(body,{ r0:0.62,r1:0.62,y0:0,y1:0.12 });
  cyl(body,{ r0:0.26,r1:0.2,y0:0.12,y1:0.5 });
  for (const [x,z] of [[0.5,0],[-0.5,0],[0,0.5],[0,-0.5]]) box(body,{ w:0.12,h:0.1,d:0.12,cx:x,cy:0.06,cz:z });
  box(body,{ w:0.1,h:0.1,d:0.4,cy:0.35,cz:-0.4 });       // barrel -Z
  cyl(glow,{ r0:0.12,r1:0.08,y0:0.5,y1:0.64 });          // core node
  return [{ prim:body, material:bodyMat(0x6c8cff) }, { prim:glow, material:glowMat(0xff2d9b) }];
}

const SKINS = {
  'ground-turret':     groundTurret,
  'dungeon-turret':    dungeonEmplacement,
  'building-sentry':   buildingSentry,
  'space-platform':    spacePlatform,
};

/* ----------------------------- validate ----------------------------- */
function validate(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('bad magic');
  if (buf.readUInt32LE(4) !== 2) throw new Error('bad version');
  if (buf.readUInt32LE(8) !== buf.length) throw new Error('length mismatch');
  const jLen=buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4E4F534A) throw new Error('chunk0 not JSON');
  const json=JSON.parse(buf.slice(20, 20+jLen).toString('utf8'));
  const binLen=buf.readUInt32LE(20+jLen);
  if (buf.readUInt32LE(24+jLen) !== 0x004E4942) throw new Error('chunk1 not BIN');
  if (json.buffers[0].byteLength > binLen) throw new Error('buffer exceeds BIN chunk');
  return { prims: json.meshes[0].primitives.length, accessors: json.accessors.length, bin: binLen };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Generating', Object.keys(SKINS).length, 'kind skins ->', OUT_DIR);
  for (const [slug, build] of Object.entries(SKINS)) {
    const glb=buildGLB(slug, build());
    const fp=path.join(OUT_DIR, slug + '.glb');
    fs.writeFileSync(fp, glb);
    const v=validate(glb);
    console.log(`  \u2713 ${slug.padEnd(18)} ${String(glb.length).padStart(6)} bytes  (prims ${v.prims}, accessors ${v.accessors})`);
  }
  console.log('Done. skinFor() fallbacks now resolve to real models.');
}
main();
