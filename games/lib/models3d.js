// 3D model store — volumetric (L3/L4) assets for the shared model scope.
//
// Files live under /srv/games/_shared/assets/models/<category>/<file>.glb and are
// served read-only to every first-party app via the existing /shared mount:
//   /shared/assets/models/<category>/<file>.glb
// Metadata (prompt, tags, source, dims) lives in Mongo collection `models3d`,
// keyed by the path relative to the models root so a filesystem walk and the
// DB always reconcile.
//
// CREATE-FROM-PROMPT has two tiers, chosen automatically per request:
//   1. Blender host (real bpy art) — used when one is configured:
//        BLENDER_BIN=/path/to/blender          (local headless; preferred)
//        BLENDER_MCP_URL=https://host/generate  (remote relay returning GLB)
//      Both run lib/blender/generate.py with the same argv contract.
//   2. Procedural fallback (dependency-free) — used when no host is present.
//      Emits a valid parametric GLB so the CRUD loop never blocks.
// Either way the path/metadata contract is identical; only `source` differs
// ('blender' vs 'procedural').
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ObjectId } = require('mongodb');

const MODELS_ROOT = '/srv/games/_shared/assets/models';
const URL_BASE = '/shared/assets/models';
const CATEGORIES = ['ships', 'mechs', 'props', 'npcs', '_generated'];
const MODEL_EXT = new Set(['.glb', '.gltf']);

const BLENDER_BIN = process.env.BLENDER_BIN || '';
const BLENDER_MCP_URL = process.env.BLENDER_MCP_URL || '';
const BLENDER_GEN_SCRIPT = process.env.BLENDER_GEN_SCRIPT
  || path.join(__dirname, 'blender', 'generate.py');

for (const c of CATEGORIES) {
  try { fs.mkdirSync(path.join(MODELS_ROOT, c), { recursive: true }); } catch (e) {}
}

let db, _col;
async function init(database) {
  db = database;
  _col = db.collection('models3d');
  await _col.createIndex({ relpath: 1 }, { unique: true });
  await _col.createIndex({ createdAt: -1 });
  await _col.createIndex({ category: 1 });
  await _col.createIndex({ tags: 1 });
}

function _id() { return crypto.randomBytes(8).toString('hex'); }
function _slug(s) {
  return String(s || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48) || 'model';
}
function _safeCategory(c) { return CATEGORIES.includes(c) ? c : '_generated'; }

function _resolve(relpath) {
  const abs = path.resolve(MODELS_ROOT, relpath);
  if (abs !== MODELS_ROOT && !abs.startsWith(MODELS_ROOT + path.sep)) {
    throw new Error('path escapes model root');
  }
  return abs;
}

function _isValidGlb(buf) {
  return Buffer.isBuffer(buf) && buf.length > 20
    && buf.toString('ascii', 0, 4) === 'glTF'
    && buf.readUInt32LE(4) === 2;
}

// ───────────────────── prompt classification (single source) ────────────────
// Maps a prompt + category to a builder kind and a base color. Shared by the
// procedural fallback AND the Blender generator so both agree on what to make.
function _classify(prompt, category) {
  const p = (prompt || '').toLowerCase();
  const has = (...k) => k.some(w => p.includes(w));
  let kind = 'prop', color = [0.65, 0.6, 0.55, 1];

  if (has('ship', 'longship', 'sail', 'boat', 'vessel') || category === 'ships') {
    kind = 'ship';
    color = has('viking', 'wood', 'oak') ? [0.45, 0.27, 0.14, 1] : [0.5, 0.35, 0.2, 1];
  } else if (has('mech', 'robot', 'bot', 'droid', 'walker') || category === 'mechs') {
    kind = 'mech'; color = [0.55, 0.58, 0.62, 1];
  } else if (has('crystal', 'gem', 'shard', 'diamond')) {
    kind = 'crystal'; color = [0.3, 0.8, 0.95, 1];
  } else if (has('tower', 'spire', 'turret') || category === 'props') {
    kind = 'tower'; color = [0.6, 0.6, 0.64, 1];
  }
  if (has('red', 'crimson', 'blood')) color = [0.8, 0.2, 0.2, 1];
  else if (has('gold', 'golden', 'brass')) color = [0.85, 0.68, 0.25, 1];
  else if (has('green', 'emerald', 'jade')) color = [0.3, 0.7, 0.35, 1];
  return { kind, color };
}

// ───────────────────────── Blender host client ──────────────────────────────
function blenderStatus() {
  if (BLENDER_BIN) return { mode: 'blender-local', bin: BLENDER_BIN, script: BLENDER_GEN_SCRIPT };
  if (BLENDER_MCP_URL) return { mode: 'blender-remote', url: BLENDER_MCP_URL };
  return { mode: 'procedural' };
}

// Returns true on success (GLB written to outAbs), false to fall through.
async function _blenderGenerate({ kind, color, prompt, outAbs }) {
  const rgb = color.slice(0, 3).join(',');

  if (BLENDER_BIN) {
    try {
      const r = spawnSync(BLENDER_BIN, [
        '--background', '--python', BLENDER_GEN_SCRIPT, '--',
        '--out', outAbs, '--kind', kind, '--prompt', prompt, '--color', rgb,
      ], { timeout: 180000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      if (r.status === 0 && fs.existsSync(outAbs) && _isValidGlb(fs.readFileSync(outAbs))) return true;
      console.error('[models3d] blender-local failed:', (r.stderr || r.stdout || 'exit ' + r.status).slice(-400));
    } catch (e) { console.error('[models3d] blender-local error:', e.message); }
    return false;
  }

  if (BLENDER_MCP_URL && typeof fetch === 'function') {
    try {
      const script = fs.readFileSync(BLENDER_GEN_SCRIPT, 'utf8');
      const resp = await fetch(BLENDER_MCP_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, prompt, color: rgb, out: path.basename(outAbs), script }),
      });
      if (!resp.ok) throw new Error('host ' + resp.status);
      const ct = resp.headers.get('content-type') || '';
      let buf;
      if (ct.includes('json')) {
        const j = await resp.json();
        if (!j.glb_base64) throw new Error('no glb_base64 in response');
        buf = Buffer.from(j.glb_base64, 'base64');
      } else {
        buf = Buffer.from(await resp.arrayBuffer());
      }
      if (!_isValidGlb(buf)) throw new Error('invalid glb from host');
      fs.writeFileSync(outAbs, buf);
      return true;
    } catch (e) { console.error('[models3d] blender-remote error:', e.message); }
    return false;
  }

  return false;
}

// ───────────────────── procedural GLB fallback (no deps) ─────────────────────
function _box(cx, cy, cz, sx, sy, sz, out) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const q = (a, b, c, d) => { out.push(v[a], v[b], v[c], v[a], v[c], v[d]); };
  q(1, 0, 3, 2); q(4, 5, 6, 7); q(0, 4, 7, 3); q(5, 1, 2, 6); q(3, 7, 6, 2); q(0, 1, 5, 4);
}
function _octa(cx, cy, cz, r, out) {
  const p = [[cx + r, cy, cz], [cx - r, cy, cz], [cx, cy + r, cz], [cx, cy - r, cz], [cx, cy, cz + r], [cx, cy, cz - r]];
  const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (const [a, b, c] of f) out.push(p[a], p[b], p[c]);
}
function _trisForKind(kind) {
  const tris = [];
  if (kind === 'ship') {
    _box(0, 0.3, 0, 0.9, 0.5, 3.0, tris);
    _box(0, 0.15, -1.6, 0.5, 0.4, 0.8, tris);
    _box(0, 0.15, 1.5, 0.6, 0.4, 0.6, tris);
    _box(0, 1.4, 0.2, 0.12, 1.8, 0.12, tris);
    _box(0, 1.7, 0.2, 1.4, 1.0, 0.06, tris);
  } else if (kind === 'mech') {
    _box(-0.3, 0.4, 0, 0.3, 0.8, 0.35, tris);
    _box(0.3, 0.4, 0, 0.3, 0.8, 0.35, tris);
    _box(0, 1.15, 0, 1.0, 0.8, 0.6, tris);
    _box(0, 1.75, 0, 0.4, 0.4, 0.4, tris);
    _box(-0.7, 1.15, 0, 0.25, 0.7, 0.25, tris);
    _box(0.7, 1.15, 0, 0.25, 0.7, 0.25, tris);
  } else if (kind === 'crystal') {
    _octa(0, 0.9, 0, 0.8, tris);
  } else if (kind === 'tower') {
    _box(0, 0.9, 0, 0.7, 1.8, 0.7, tris);
    _box(0, 2.0, 0, 0.95, 0.4, 0.95, tris);
  } else {
    _box(0, 0.5, 0, 1, 1, 1, tris);
  }
  return tris;
}
function _buildGlb(tris, color) {
  const triCount = tris.length / 3;
  const positions = new Float32Array(tris.length * 3);
  const normals = new Float32Array(tris.length * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triCount; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      const vtx = [a, b, c][k], o = (t * 3 + k) * 3;
      positions[o] = vtx[0]; positions[o + 1] = vtx[1]; positions[o + 2] = vtx[2];
      normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz;
      for (let d = 0; d < 3; d++) { if (vtx[d] < min[d]) min[d] = vtx[d]; if (vtx[d] > max[d]) max[d] = vtx[d]; }
    }
  }
  const posBytes = Buffer.from(positions.buffer);
  const nrmBytes = Buffer.from(normals.buffer);
  const bin = Buffer.concat([posBytes, nrmBytes]);
  const count = tris.length;
  const gltf = {
    asset: { version: '2.0', generator: 'madladslab-models3d/procedural' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0.1, roughnessFactor: 0.7 }, name: 'mat' }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: nrmBytes.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  while (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.from(' ')]);
  let binChunk = bin;
  while (binChunk.length % 4 !== 0) binChunk = Buffer.concat([binChunk, Buffer.from([0])]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8);
  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(json.length, 0); jsonHdr.writeUInt32LE(0x4E4F534A, 4);
  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(binChunk.length, 0); binHdr.writeUInt32LE(0x004E4942, 4);
  return { glb: Buffer.concat([header, jsonHdr, json, binHdr, binChunk]), triCount };
}

// ───────────────────────── public API ───────────────────────────────────────
async function generateFromPrompt({ prompt, name, category, author = '' }) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt required');
  category = _safeCategory(category);
  const id = _id();
  const base = `${_slug(name || prompt)}-${id.slice(0, 6)}.glb`;
  const relpath = path.posix.join(category, base);
  const abs = _resolve(relpath);
  const { kind, color } = _classify(prompt, category);

  let source = 'procedural', triangles = null, bytes = 0;
  const viaBlender = await _blenderGenerate({ kind, color, prompt: String(prompt), outAbs: abs });
  if (viaBlender) {
    source = 'blender';
    bytes = fs.statSync(abs).size;
  } else {
    const { glb, triCount } = _buildGlb(_trisForKind(kind), color);
    fs.writeFileSync(abs, glb);
    triangles = triCount; bytes = glb.length;
  }

  const doc = {
    relpath, url: path.posix.join(URL_BASE, relpath),
    name: name ? String(name).slice(0, 120) : base.replace(/\.glb$/, ''),
    category, kind, prompt: String(prompt).slice(0, 1000), source,
    author: String(author || '').slice(0, 120), tags: [],
    bytes, triangles, createdAt: new Date(), updatedAt: new Date(),
  };
  const r = await _col.insertOne(doc);
  return Object.assign({ _id: r.insertedId }, doc);
}

async function saveUpload({ buffer, name, category, author = '' }) {
  if (!buffer || !buffer.length) throw new Error('empty upload');
  const ext = (name && path.extname(name).toLowerCase()) || '.glb';
  if (!MODEL_EXT.has(ext)) throw new Error('only .glb/.gltf allowed');
  category = _safeCategory(category);
  const id = _id();
  const base = `${_slug(name || 'upload')}-${id.slice(0, 6)}${ext}`;
  const relpath = path.posix.join(category, base);
  fs.writeFileSync(_resolve(relpath), buffer);
  const doc = {
    relpath, url: path.posix.join(URL_BASE, relpath),
    name: name ? String(name).slice(0, 120) : base, category,
    prompt: '', source: 'upload', author: String(author).slice(0, 120),
    tags: [], bytes: buffer.length, createdAt: new Date(), updatedAt: new Date(),
  };
  const r = await _col.insertOne(doc);
  return Object.assign({ _id: r.insertedId }, doc);
}

async function tree() {
  const meta = {};
  for (const m of await _col.find({}).toArray()) meta[m.relpath] = m;
  function walk(absDir, relDir) {
    const entries = fs.readdirSync(absDir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    const out = [];
    for (const e of entries) {
      const rel = path.posix.join(relDir, e.name);
      if (e.isDirectory()) {
        out.push({ type: 'dir', name: e.name, path: rel, children: walk(path.join(absDir, e.name), rel) });
      } else if (MODEL_EXT.has(path.extname(e.name).toLowerCase())) {
        const md = meta[rel] || {};
        out.push({
          type: 'model', name: e.name, path: rel, url: path.posix.join(URL_BASE, rel),
          id: md._id ? String(md._id) : null, source: md.source || 'unknown',
          prompt: md.prompt || '', tags: md.tags || [],
          bytes: md.bytes || fs.statSync(path.join(absDir, e.name)).size,
        });
      }
    }
    return out;
  }
  return walk(MODELS_ROOT, '');
}

async function list({ category = null, limit = 200 } = {}) {
  const q = {};
  if (category && CATEGORIES.includes(category)) q.category = category;
  return _col.find(q).sort({ createdAt: -1 }).limit(limit).toArray();
}

async function get(id) { return _col.findOne({ _id: new ObjectId(String(id)) }); }

async function update(id, { name, category, tags } = {}) {
  const doc = await get(id);
  if (!doc) return { ok: false, error: 'not found' };
  const set = { updatedAt: new Date() };
  let newRel = doc.relpath;
  if (category && CATEGORIES.includes(category) && category !== doc.category) {
    newRel = path.posix.join(category, path.basename(doc.relpath));
    set.category = category;
  }
  if (name && _slug(name) !== _slug(path.basename(doc.relpath, '.glb'))) {
    const ext = path.extname(doc.relpath) || '.glb';
    newRel = path.posix.join(path.dirname(newRel), `${_slug(name)}-${_id().slice(0, 6)}${ext}`);
    set.name = String(name).slice(0, 120);
  }
  if (newRel !== doc.relpath) {
    fs.renameSync(_resolve(doc.relpath), _resolve(newRel));
    set.relpath = newRel; set.url = path.posix.join(URL_BASE, newRel);
  }
  if (Array.isArray(tags)) set.tags = tags.slice(0, 20).map(t => String(t).slice(0, 40));
  await _col.updateOne({ _id: doc._id }, { $set: set });
  return { ok: true, model: Object.assign({}, doc, set) };
}

async function remove(id) {
  const doc = await get(id);
  if (!doc) return { ok: false };
  try { fs.unlinkSync(_resolve(doc.relpath)); } catch (e) {}
  await _col.deleteOne({ _id: doc._id });
  return { ok: true };
}

module.exports = {
  init, generateFromPrompt, saveUpload, tree, list, get, update, remove,
  blenderStatus, MODELS_ROOT, CATEGORIES,
};
