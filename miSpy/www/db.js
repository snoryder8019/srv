// db.js — tiny IndexedDB wrapper. All data lives on the device, offline.
const DB_NAME = 'mispy';
const DB_VERSION = 1;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('trips')) {
        db.createObjectStore('trips', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        db.createObjectStore('expenses', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
  }));
}

export const db = {
  put(store, value) { return tx(store, 'readwrite', s => ({ __req: s.put(value) })); },
  delete(store, key) { return tx(store, 'readwrite', s => ({ __req: s.delete(key) })); },
  get(store, key) { return tx(store, 'readonly', s => ({ __req: s.get(key) })); },
  all(store) {
    return open().then(d => new Promise((resolve, reject) => {
      const out = [];
      const c = d.transaction(store, 'readonly').objectStore(store).openCursor();
      c.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { out.push(cur.value); cur.continue(); } else resolve(out);
      };
      c.onerror = () => reject(c.error);
    }));
  },
  async setting(key, value) {
    if (value === undefined) {
      const r = await this.get('settings', key);
      return r ? r.value : undefined;
    }
    return this.put('settings', { key, value });
  }
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
