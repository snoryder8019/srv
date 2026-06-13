/**
 * gen-gltf-madlands.js — native-shape GLB batch for the Madlands explorer.
 * Procedural (no Blender host needed), same binary-glTF writer as the TD skins.
 * Output: public/assets/models/madlands/{creature,structure,vehicle,item,hazard}.glb
 * Contract: base on y=0, ~square footprint, front faces -Z. Loaded with a
 * primitive fallback per BLENDER_SD_PROTOCOL (geometry layer L3/L4).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'models', 'madlands');

/* geometry */
function newPrim() { return { positions: [], normals: [], indices: [] }; }
function tri(p, a, b, c) {
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2], vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx; const L=Math.hypot(nx,ny,nz)||1; nx/=L;ny/=L;nz/=L;
  const i=p.positions.length/3; for (const q of [a,b,c]) { p.positions.push(q[0],q[1],q[2]); p.normals.push(nx,ny,nz); } p.indices.push(i,i+1,i+2);
}
function quad(p,a,b,c,d){ tri(p,a,b,c); tri(p,a,c,d); }
function box(p,{w,h,d,cx=0,cy=0,cz=0}){ const x0=cx-w/2,x1=cx+w/2,y0=cy-h/2,y1=cy+h/2,z0=cz-d/2,z1=cz+d/2;
  const v=[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
  quad(p,v[4],v[5],v[6],v[7]); quad(p,v[3],v[2],v[1],v[0]); quad(p,v[0],v[1],v[5],v[4]); quad(p,v[2],v[3],v[7],v[6]); quad(p,v[1],v[2],v[6],v[5]); quad(p,v[3],v[0],v[4],v[7]); }
function cyl(p,{r0,r1,y0,y1,seg=10,cap=true,cx=0,cz=0}){ for(let i=0;i<seg;i++){ const t0=i/seg*6.2832,t1=(i+1)/seg*6.2832;
  const bl=[cx+Math.cos(t0)*r0,y0,cz+Math.sin(t0)*r0],br=[cx+Math.cos(t1)*r0,y0,cz+Math.sin(t1)*r0],tl=[cx+Math.cos(t0)*r1,y1,cz+Math.sin(t0)*r1],tr=[cx+Math.cos(t1)*r1,y1,cz+Math.sin(t1)*r1];
  quad(p,bl,br,tr,tl); if(cap){ tri(p,[cx,y1,cz],tl,tr); tri(p,[cx,y0,cz],br,bl);} } }
function cone(p,o){ cyl(p,{...o,r1:0}); }
function ico(p,{r,cx=0,cy=0,cz=0}){ // cheap faceted blob: octahedron
  const P=[[0,r,0],[0,-r,0],[r,0,0],[-r,0,0],[0,0,r],[0,0,-r]].map(([x,y,z])=>[x+cx,y+cy,z+cz]);
  const f=[[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,4,2],[1,3,4],[1,5,3],[1,2,5]]; for(const[a,b,c] of f) tri(p,P[a],P[b],P[c]); }

/* materials */
function srgb(hex){const r=((hex>>16)&255)/255,g=((hex>>8)&255)/255,b=(hex&255)/255;const L=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;return[L(r),L(g),L(b)];}
function mat(hex,{m=0.4,r=0.6}={}){const[R,G,B]=srgb(hex);return{pbrMetallicRoughness:{baseColorFactor:[R,G,B,1],metallicFactor:m,roughnessFactor:r}};}
function glow(hex){const[R,G,B]=srgb(hex);return{pbrMetallicRoughness:{baseColorFactor:[R,G,B,1],metallicFactor:0,roughnessFactor:0.25},emissiveFactor:[Math.min(1,R),Math.min(1,G),Math.min(1,B)]};}

/* GLB writer */
function buildGLB(name,groups){ const views=[],acc=[],prims=[],mats=[],chunks=[]; let off=0; const al=n=>(n+3)&~3;
  function add(t,target){const b=Buffer.from(t.buffer,t.byteOffset,t.byteLength);views.push({buffer:0,byteOffset:off,byteLength:b.length,target});chunks.push(b);const pad=al(b.length)-b.length;if(pad)chunks.push(Buffer.alloc(pad));off+=b.length+pad;return views.length-1;}
  groups.forEach((g,gi)=>{const pos=new Float32Array(g.prim.positions),nrm=new Float32Array(g.prim.normals),idx=new Uint16Array(g.prim.indices);
    const mn=[1/0,1/0,1/0],mx=[-1/0,-1/0,-1/0];for(let i=0;i<pos.length;i+=3)for(let k=0;k<3;k++){const v=pos[i+k];if(v<mn[k])mn[k]=v;if(v>mx[k])mx[k]=v;}
    const vP=add(pos,34962),aP=acc.length;acc.push({bufferView:vP,componentType:5126,count:pos.length/3,type:'VEC3',min:mn,max:mx});
    const vN=add(nrm,34962),aN=acc.length;acc.push({bufferView:vN,componentType:5126,count:nrm.length/3,type:'VEC3'});
    const vI=add(idx,34963),aI=acc.length;acc.push({bufferView:vI,componentType:5123,count:idx.length,type:'SCALAR'});
    prims.push({attributes:{POSITION:aP,NORMAL:aN},indices:aI,material:gi});mats.push(g.material);});
  const bin=Buffer.concat(chunks);
  const json={asset:{version:'2.0',generator:'madlands-geo-gen'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name}],meshes:[{name,primitives:prims}],materials:mats,accessors:acc,bufferViews:views,buffers:[{byteLength:bin.length}]};
  let jb=Buffer.from(JSON.stringify(json),'utf8');const jp=al(jb.length)-jb.length;if(jp)jb=Buffer.concat([jb,Buffer.alloc(jp,0x20)]);
  let bb=bin;const bp=al(bb.length)-bb.length;if(bp)bb=Buffer.concat([bb,Buffer.alloc(bp,0)]);
  const total=12+8+jb.length+8+bb.length;const o=Buffer.alloc(total);let p=0;
  o.writeUInt32LE(0x46546C67,p);p+=4;o.writeUInt32LE(2,p);p+=4;o.writeUInt32LE(total,p);p+=4;
  o.writeUInt32LE(jb.length,p);p+=4;o.writeUInt32LE(0x4E4F534A,p);p+=4;jb.copy(o,p);p+=jb.length;
  o.writeUInt32LE(bb.length,p);p+=4;o.writeUInt32LE(0x004E4942,p);p+=4;bb.copy(o,p);return o; }

/* models — base on y=0, front -Z, ~1.0-1.5 tall, square footprint */
function creature(){ const b=newPrim(),e=newPrim();
  cyl(b,{r0:0.42,r1:0.34,y0:0.28,y1:0.86,seg:10});               // torso
  ico(b,{r:0.3,cy:0.98,cz:-0.18});                                // head (forward -Z)
  for(const x of [-0.26,0.26]) for(const z of [-0.22,0.22]) cyl(b,{r0:0.1,r1:0.08,y0:0,y1:0.3,cx:x,cz:z,seg:6}); // legs
  ico(e,{r:0.07,cx:-0.11,cy:1.02,cz:-0.42}); ico(e,{r:0.07,cx:0.11,cy:1.02,cz:-0.42});                            // eyes
  return [{prim:b,material:mat(0x7d4a8c,{m:0.3,r:0.7})},{prim:e,material:glow(0x7cffb2)}]; }
function structure(){ const b=newPrim(),e=newPrim();
  box(b,{w:1.1,h:0.5,d:1.1,cy:0.25}); box(b,{w:0.8,h:0.9,d:0.8,cy:0.95}); cone(b,{r0:0.62,y0:1.4,y1:2.0,seg:6});
  for(const x of [-0.22,0.22]) box(e,{w:0.16,h:0.16,d:0.04,cx:x,cy:0.95,cz:-0.41});  // lit windows
  return [{prim:b,material:mat(0x7d6c90,{m:0.2,r:0.8})},{prim:e,material:glow(0xffd24a)}]; }
function vehicle(){ const b=newPrim(),e=newPrim();
  box(b,{w:1.3,h:0.4,d:0.8,cy:0.4}); box(b,{w:0.7,h:0.34,d:0.6,cy:0.74,cz:-0.05});
  for(const x of [-0.5,0.5]) for(const z of [-0.28,0.28]) cyl(b,{r0:0.18,r1:0.18,y0:0.0,y1:0.16,cx:x,cz:z,seg:8});
  box(e,{w:0.16,h:0.1,d:0.04,cy:0.45,cz:-0.41});  // headlight
  return [{prim:b,material:mat(0xa3caff,{m:0.6,r:0.4})},{prim:e,material:glow(0xfff0b0)}]; }
function item(){ const b=newPrim(),e=newPrim();
  ico(e,{r:0.4,cy:0.7}); ico(e,{r:0.16,cx:0.34,cy:0.45}); ico(e,{r:0.13,cx:-0.3,cy:0.95});
  cyl(b,{r0:0.28,r1:0.18,y0:0,y1:0.18,seg:6});  // pedestal
  return [{prim:b,material:mat(0x3a2f1a,{m:0.4,r:0.6})},{prim:e,material:glow(0xffd24a)}]; }
function hazard(){ const b=newPrim(),e=newPrim();
  for(let i=0;i<6;i++){const a=i/6*6.2832; cone(b,{r0:0.16,y0:0,y1:0.9,seg:5,cx:Math.cos(a)*0.42,cz:Math.sin(a)*0.42});}
  ico(e,{r:0.22,cy:0.5});  // venom core
  return [{prim:b,material:mat(0x6a2740,{m:0.3,r:0.7})},{prim:e,material:glow(0xff2d9b)}]; }

const MODELS={creature,structure,vehicle,item,hazard};
fs.mkdirSync(OUT,{recursive:true});
for(const [name,build] of Object.entries(MODELS)){ const glb=buildGLB(name,build()); const fp=path.join(OUT,name+'.glb'); fs.writeFileSync(fp,glb);
  // validate
  if(glb.readUInt32LE(0)!==0x46546C67||glb.readUInt32LE(8)!==glb.length) throw new Error('bad glb '+name);
  console.log(`  \u2713 ${name.padEnd(10)} ${String(glb.length).padStart(6)} bytes`); }
console.log('Madlands GLB batch ->',OUT);
