// Communications asset store — images (mostly SD-generated) and videos
// (URL-referenced for now; the SD pipeline only emits PNGs).
//
// Storage strategy: PNGs are written to /srv/games/public/uploads/assets/
// so the existing /static mount serves them. Metadata lives in Mongo so we
// can query by tag, kind, prompt, etc. for the admin Assets panel and the
// AI composer's "pick thumbnail" picker.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const ASSET_DIR = path.join(__dirname, '..', 'public', 'uploads', 'assets');
try { fs.mkdirSync(ASSET_DIR, { recursive: true }); } catch (e) {}

const VALID_TYPES = new Set(['image', 'video']);
const VALID_SOURCES = new Set(['sd', 'upload', 'external']);

let db;
let _col;

async function init(database) {
  db = database;
  _col = db.collection('assets');
  await _col.createIndex({ createdAt: -1 });
  await _col.createIndex({ type: 1, source: 1 });
  await _col.createIndex({ tags: 1 });
}

function _id() { return crypto.randomBytes(8).toString('hex'); }

// Save a base64 PNG (from the SD API) to disk and record it.
async function saveSdImage({ prompt, base64, author = '', tags = [], size = '512x512' }) {
  if (!base64) throw new Error('base64 required');
  const id = _id();
  const fname = id + '.png';
  const fpath = path.join(ASSET_DIR, fname);
  fs.writeFileSync(fpath, Buffer.from(base64, 'base64'));
  const url = '/static/uploads/assets/' + fname;
  const doc = {
    type: 'image',
    source: 'sd',
    url,
    filename: fname,
    prompt: String(prompt || '').slice(0, 1000),
    size: String(size).slice(0, 20),
    author: String(author || '').slice(0, 120),
    tags: Array.isArray(tags) ? tags.slice(0, 20).map(t => String(t).slice(0, 40)) : [],
    bytes: fs.statSync(fpath).size,
    createdAt: new Date(),
  };
  const r = await _col.insertOne(doc);
  return Object.assign({ _id: r.insertedId }, doc);
}

// External video URL (YouTube, Vimeo, direct mp4 on a CDN). We don't host
// videos locally — the games VM doesn't have the disk budget.
async function registerExternal({ type = 'image', url, author = '', tags = [], title = '' }) {
  if (!url) throw new Error('url required');
  if (!VALID_TYPES.has(type)) type = 'image';
  const doc = {
    type,
    source: 'external',
    url: String(url).slice(0, 600),
    title: String(title || '').slice(0, 200),
    author: String(author || '').slice(0, 120),
    tags: Array.isArray(tags) ? tags.slice(0, 20).map(t => String(t).slice(0, 40)) : [],
    createdAt: new Date(),
  };
  const r = await _col.insertOne(doc);
  return Object.assign({ _id: r.insertedId }, doc);
}

async function list({ type = null, source = null, limit = 60 } = {}) {
  const q = {};
  if (type && VALID_TYPES.has(type)) q.type = type;
  if (source && VALID_SOURCES.has(source)) q.source = source;
  return _col.find(q).sort({ createdAt: -1 }).limit(limit).toArray();
}

async function get(id) {
  return _col.findOne({ _id: new ObjectId(String(id)) });
}

async function remove(id) {
  const doc = await get(id);
  if (!doc) return { ok: false };
  if (doc.source === 'sd' && doc.filename) {
    try { fs.unlinkSync(path.join(ASSET_DIR, doc.filename)); } catch (e) {}
  }
  await _col.deleteOne({ _id: doc._id });
  return { ok: true };
}

module.exports = { init, saveSdImage, registerExternal, list, get, remove };
