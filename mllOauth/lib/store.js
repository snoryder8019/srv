// Tiny file-backed key/value store for short-lived auth codes and refresh
// tokens. Single-process; writes are debounced-synchronous (fine at this scale).
import { readFileSync, writeFileSync, existsSync } from 'fs';

export class Store {
  constructor(path) {
    this.path = path;
    this.data = { codes: {}, refresh: {} };
    if (existsSync(path)) {
      try { this.data = JSON.parse(readFileSync(path, 'utf8')); } catch { /* start fresh */ }
    }
    if (!this.data.codes) this.data.codes = {};
    if (!this.data.refresh) this.data.refresh = {};
  }

  #flush() {
    writeFileSync(this.path, JSON.stringify(this.data), { mode: 0o600 });
  }

  #sweep() {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, v] of Object.entries(this.data.codes)) if (v.exp <= now) delete this.data.codes[k];
    for (const [k, v] of Object.entries(this.data.refresh)) if (v.exp <= now) delete this.data.refresh[k];
  }

  putCode(code, rec) { this.#sweep(); this.data.codes[code] = rec; this.#flush(); }
  takeCode(code) {                       // one-time use: read + delete
    this.#sweep();
    const rec = this.data.codes[code];
    if (rec) { delete this.data.codes[code]; this.#flush(); }
    return rec;
  }

  putRefresh(token, rec) { this.#sweep(); this.data.refresh[token] = rec; this.#flush(); }
  takeRefresh(token) {                    // rotated on use: read + delete
    this.#sweep();
    const rec = this.data.refresh[token];
    if (rec) { delete this.data.refresh[token]; this.#flush(); }
    return rec;
  }
}
