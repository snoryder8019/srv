'use strict';

/**
 * World Config — per-game editable settings exposed to the "New World" admin
 * modal. Each game declares:
 *   file:    absolute path to the config file
 *   format:  parser/writer to use (rust-cvar | xml-property | ini-section | json-path | shell-var)
 *   fields:  [{ key, label, type, default, help?, options? }]
 *
 * `key` is the format-specific accessor:
 *   rust-cvar       — full cvar name, e.g. "server.hostname"
 *   xml-property    — name attribute of <property name="...">
 *   ini-section     — section.key inside [/Script/Pal.PalGameWorldSettings] OptionSettings=(...)
 *   json-path       — dot path into the JSON, e.g. "ServerDescription_Persistent.MaxPlayerCount"
 *   shell-var       — bash assignment name, e.g. WORLD_NAME (replaces `WORLD_NAME="..."` line)
 *
 * For SE (xml-element) `key` is the element name inside <SessionSettings>.
 *
 * The "wipe" path lists directories to clear when an admin starts a NEW world
 * from scratch (after auto-backup). Empty = no wipe (config-only restart).
 */

const fs   = require('fs');
const path = require('path');

const CONFIGS = {
  rust: {
    file: '/srv/games/rust/server/madlads/cfg/serverauto.cfg',
    format: 'rust-cvar',
    // Wipe what counts as a fresh Rust map: per-identity save dir + map.
    wipe: ['/srv/games/rust/server/madlads/'],
    wipeKeep: ['cfg', 'oxide', 'carbon'],
    fields: [
      { key: 'server.hostname',    label: 'Server Name',       type: 'text',   default: 'MadLadsLab Rust' },
      { key: 'server.description', label: 'Description',       type: 'text',   default: 'Powered by MadLadsLab' },
      { key: 'server.maxplayers',  label: 'Max Players',       type: 'number', default: 50, min: 2, max: 200 },
      { key: 'server.worldsize',   label: 'World Size',        type: 'number', default: 3500, min: 1000, max: 6000, help: 'Procgen map size; 3500 is balanced' },
      { key: 'server.seed',        label: 'Map Seed',          type: 'number', default: 12345, help: 'Different seed = different map' },
      { key: 'server.pve',         label: 'PvE Mode',          type: 'bool',   default: false },
    ],
  },

  valheim: {
    file: '/srv/games/start-valheim.sh',
    format: 'shell-var',
    wipe: ['/srv/games/valheim/worlds/'],
    fields: [
      { key: 'SERVER_NAME',     label: 'Server Name',  type: 'text', default: 'MadLadsLab Valheim' },
      { key: 'SERVER_PASSWORD', label: 'Password',     type: 'text', default: 'changeme_valheim_pass', help: 'Required by Valheim — min 5 chars' },
      { key: 'WORLD_NAME',      label: 'World Name',   type: 'text', default: 'MadLads', help: 'Generates a fresh world if none exists with this name' },
    ],
  },

  '7dtd': {
    file: '/srv/games/7dtd/serverconfig.xml',
    format: 'xml-property',
    wipe: ['/srv/games/7dtd/UserDataFolder/Saves/'],
    fields: [
      { key: 'ServerName',           label: 'Server Name',  type: 'text',   default: 'MadLadsLab 7DTD' },
      { key: 'ServerDescription',    label: 'Description',  type: 'text',   default: 'A 7 Days to Die server' },
      { key: 'ServerPassword',       label: 'Password',     type: 'text',   default: '',          help: 'Empty = no password' },
      { key: 'ServerMaxPlayerCount', label: 'Max Players',  type: 'number', default: 8, min: 2, max: 64 },
      { key: 'GameWorld',            label: 'World Type',   type: 'select', default: 'Navezgane', options: ['Navezgane', 'RWG', 'Pregen06k01', 'Pregen08k01', 'Pregen10k01'] },
      { key: 'WorldGenSeed',         label: 'RWG Seed',     type: 'text',   default: 'MadLads',   help: 'Only used when World Type = RWG' },
      { key: 'WorldGenSize',         label: 'RWG Size',     type: 'select', default: '6144',      options: ['6144', '8192', '10240'] },
    ],
  },

  se: {
    file: '/srv/games/se/Instance/SpaceEngineers-Dedicated.cfg',
    format: 'xml-element',
    elementParent: 'SessionSettings',
    wipe: ['/srv/games/se/Instance/Saves/'],
    fields: [
      { key: 'GameMode',          label: 'Game Mode',    type: 'select', default: 'Survival', options: ['Survival', 'Creative'] },
      { key: 'MaxPlayers',        label: 'Max Players',  type: 'number', default: 4, min: 2, max: 16 },
      { key: 'OnlineMode',        label: 'Visibility',   type: 'select', default: 'PUBLIC', options: ['PUBLIC', 'FRIENDS', 'PRIVATE'] },
      { key: 'AutoSaveInMinutes', label: 'Auto-save (min)', type: 'number', default: 5, min: 1, max: 30 },
      { key: 'EnableCopyPaste',   label: 'Allow Copy-Paste', type: 'bool', default: false },
      { key: 'WorldSizeKm',       label: 'World Size (km)',  type: 'number', default: 0, min: 0, max: 100, help: '0 = unbounded' },
    ],
  },

  palworld: {
    file: '/srv/games/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
    format: 'ini-section',
    iniSection: '[/Script/Pal.PalGameWorldSettings]',
    iniKey: 'OptionSettings',
    wipe: ['/srv/games/palworld/Pal/Saved/SaveGames/'],
    fields: [
      { key: 'ServerName',          label: 'Server Name',     type: 'text',   default: 'MadLadsLab Palworld' },
      { key: 'ServerDescription',   label: 'Description',     type: 'text',   default: '' },
      { key: 'ServerPassword',      label: 'Password',        type: 'text',   default: 'hello_palworld' },
      { key: 'AdminPassword',       label: 'Admin Password',  type: 'text',   default: 'hello_palworld' },
      { key: 'ServerPlayerMaxNum',  label: 'Max Players',     type: 'number', default: 32, min: 2, max: 32 },
      { key: 'Difficulty',          label: 'Difficulty',      type: 'select', default: 'None', options: ['None', 'Casual', 'Normal', 'Hard'] },
      { key: 'DeathPenalty',        label: 'Death Penalty',   type: 'select', default: 'All',  options: ['None', 'Item', 'ItemAndEquipment', 'All'] },
      { key: 'bIsPvP',              label: 'PvP',             type: 'bool',   default: false },
      { key: 'ExpRate',             label: 'XP Rate',         type: 'number', default: 1.0, step: 0.1, min: 0.1, max: 20 },
    ],
  },

  windrose: {
    file: '/srv/games/windrose/R5/ServerDescription.json',
    format: 'json-path',
    wipe: ['/srv/games/windrose/R5/Saved/SaveProfiles/'],
    fields: [
      { key: 'ServerDescription_Persistent.ServerName',          label: 'Server Name',  type: 'text',   default: '' },
      { key: 'ServerDescription_Persistent.MaxPlayerCount',      label: 'Max Players',  type: 'number', default: 8, min: 2, max: 16 },
      { key: 'ServerDescription_Persistent.IsPasswordProtected', label: 'Password Protected', type: 'bool', default: false },
      { key: 'ServerDescription_Persistent.Password',            label: 'Password',     type: 'text',   default: '' },
    ],
  },

  // l4d2 has no persistent "world" — gamemode/map is picked per match via cfg
  // scripts. Excluded from the new-world flow on purpose.
};

function isSupported(game) {
  return !!CONFIGS[game];
}

function getSchema(game) {
  const cfg = CONFIGS[game];
  if (!cfg) return null;
  // Return a UI-safe shape — no absolute file paths, no wipe targets.
  return {
    game,
    format: cfg.format,
    fields: cfg.fields.map(f => ({ ...f })),
  };
}

function listSupportedGames() {
  return Object.keys(CONFIGS);
}

// ── Read current values from disk so the modal can pre-fill ──
function readCurrent(game) {
  const cfg = CONFIGS[game];
  if (!cfg) return null;

  let raw;
  try { raw = fs.readFileSync(cfg.file, 'utf8'); }
  catch (e) { return cfg.fields.reduce((acc, f) => (acc[f.key] = f.default, acc), {}); }

  const out = {};
  for (const f of cfg.fields) {
    let v;
    try {
      switch (cfg.format) {
        case 'rust-cvar':    v = _readRustCvar(raw, f.key); break;
        case 'xml-property': v = _readXmlProperty(raw, f.key); break;
        case 'xml-element':  v = _readXmlElement(raw, cfg.elementParent, f.key); break;
        case 'ini-section':  v = _readIniField(raw, cfg.iniSection, cfg.iniKey, f.key); break;
        case 'json-path':    v = _readJsonPath(raw, f.key); break;
        case 'shell-var':    v = _readShellVar(raw, f.key); break;
        default: v = f.default;
      }
    } catch (e) { v = f.default; }
    out[f.key] = (v === undefined || v === null) ? f.default : _coerce(f, v);
  }
  return out;
}

// ── Apply new values to disk ──
// Returns { ok, changed: [keys], errors: [{key, message}] }
function applySettings(game, values) {
  const cfg = CONFIGS[game];
  if (!cfg) return { ok: false, error: 'Unsupported game: ' + game };

  let raw;
  try { raw = fs.readFileSync(cfg.file, 'utf8'); }
  catch (e) { return { ok: false, error: 'Cannot read ' + cfg.file + ': ' + e.message }; }

  const changed = [];
  const errors = [];

  for (const f of cfg.fields) {
    if (!(f.key in values)) continue;
    const raw_v = values[f.key];
    let v;
    try { v = _coerce(f, raw_v); }
    catch (e) { errors.push({ key: f.key, message: e.message }); continue; }

    try {
      switch (cfg.format) {
        case 'rust-cvar':    raw = _writeRustCvar(raw, f.key, v); break;
        case 'xml-property': raw = _writeXmlProperty(raw, f.key, v); break;
        case 'xml-element':  raw = _writeXmlElement(raw, cfg.elementParent, f.key, v); break;
        case 'ini-section':  raw = _writeIniField(raw, cfg.iniSection, cfg.iniKey, f.key, v); break;
        case 'json-path':    raw = _writeJsonPath(raw, f.key, v); break;
        case 'shell-var':    raw = _writeShellVar(raw, f.key, v); break;
        default: errors.push({ key: f.key, message: 'Unknown format ' + cfg.format });
      }
      changed.push(f.key);
    } catch (e) {
      errors.push({ key: f.key, message: e.message });
    }
  }

  if (changed.length) {
    // Sanity backup before overwrite.
    try { fs.copyFileSync(cfg.file, cfg.file + '.bak.' + Date.now()); } catch {}
    fs.writeFileSync(cfg.file, raw, 'utf8');
  }

  return { ok: errors.length === 0, changed, errors, file: cfg.file };
}

// ── Wipe world data (used by "Start a fresh world" path) ──
// Returns { ok, wiped: [paths] }
function wipeWorld(game) {
  const cfg = CONFIGS[game];
  if (!cfg || !cfg.wipe || !cfg.wipe.length) return { ok: true, wiped: [] };
  const wiped = [];
  for (const p of cfg.wipe) {
    try {
      if (!fs.existsSync(p)) continue;
      const stat = fs.statSync(p);
      if (!stat.isDirectory()) continue;
      const keep = cfg.wipeKeep || [];
      for (const entry of fs.readdirSync(p)) {
        if (keep.includes(entry)) continue;
        const full = path.join(p, entry);
        fs.rmSync(full, { recursive: true, force: true });
        wiped.push(full);
      }
    } catch (e) {
      console.error('[world-config] wipe failed for', p, e.message);
    }
  }
  return { ok: true, wiped };
}

// ── Coercion ──
function _coerce(field, v) {
  if (v === null || v === undefined) return field.default;
  switch (field.type) {
    case 'number': {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isFinite(n)) throw new Error('not a number');
      if (field.min !== undefined && n < field.min) throw new Error('< min ' + field.min);
      if (field.max !== undefined && n > field.max) throw new Error('> max ' + field.max);
      return n;
    }
    case 'bool': {
      if (typeof v === 'boolean') return v;
      const s = String(v).toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'on';
    }
    case 'select': {
      const s = String(v);
      if (field.options && !field.options.includes(s)) throw new Error('not in options');
      return s;
    }
    default: return String(v);
  }
}

// ── rust-cvar parser ──
// Lines look like:  server.hostname "MadLadsLab Rust"
function _readRustCvar(raw, key) {
  const re = new RegExp('^' + _escRe(key) + '\\s+"([^"]*)"', 'm');
  const m = raw.match(re);
  return m ? m[1] : undefined;
}
function _writeRustCvar(raw, key, value) {
  const lineVal = _rustVal(value);
  const re = new RegExp('^(' + _escRe(key) + ')\\s+"[^"]*"', 'm');
  if (re.test(raw)) return raw.replace(re, key + ' "' + lineVal + '"');
  return raw.replace(/\s*$/, '\n' + key + ' "' + lineVal + '"\n');
}
function _rustVal(v) {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v).replace(/"/g, '\\"');
}

// ── XML property (7dtd):  <property name="ServerName" value="..." /> ──
function _readXmlProperty(raw, key) {
  const re = new RegExp('<property\\s+name="' + _escRe(key) + '"\\s+value="([^"]*)"', 'm');
  const m = raw.match(re);
  return m ? m[1] : undefined;
}
function _writeXmlProperty(raw, key, value) {
  const v = _xmlEsc(String(value));
  const re = new RegExp('(<property\\s+name="' + _escRe(key) + '"\\s+value=)"[^"]*"', 'm');
  if (!re.test(raw)) throw new Error('property ' + key + ' not found in XML');
  return raw.replace(re, '$1"' + v + '"');
}

// ── XML element (SE):  <MaxPlayers>4</MaxPlayers> inside <SessionSettings> ──
function _readXmlElement(raw, parent, tag) {
  const re = new RegExp('<' + _escRe(tag) + '>([^<]*)</' + _escRe(tag) + '>', 'm');
  const m = raw.match(re);
  return m ? m[1] : undefined;
}
function _writeXmlElement(raw, parent, tag, value) {
  const v = _xmlEsc(String(value));
  const re = new RegExp('(<' + _escRe(tag) + '>)[^<]*(</' + _escRe(tag) + '>)', 'm');
  if (!re.test(raw)) throw new Error('element ' + tag + ' not found in XML');
  return raw.replace(re, '$1' + v + '$2');
}

// ── INI section (palworld): OptionSettings=(K=V,K=V,...) inside [Section] ──
function _readIniField(raw, section, iniKey, fieldKey) {
  const tuple = _extractTuple(raw, section, iniKey);
  if (!tuple) return undefined;
  return _tupleGet(tuple, fieldKey);
}
function _writeIniField(raw, section, iniKey, fieldKey, value) {
  const tuple = _extractTuple(raw, section, iniKey);
  if (!tuple) throw new Error('section ' + section + '/' + iniKey + ' not found');
  const next = _tupleSet(tuple, fieldKey, value);
  const re = new RegExp('(' + _escRe(section) + '[\\s\\S]*?' + _escRe(iniKey) + '=\\()' + _escRe(tuple) + '(\\))', 'm');
  if (!re.test(raw)) throw new Error('cannot locate tuple in ' + iniKey);
  return raw.replace(re, '$1' + next + '$2');
}
function _extractTuple(raw, section, iniKey) {
  const re = new RegExp(_escRe(section) + '[\\s\\S]*?' + _escRe(iniKey) + '=\\(([^]*?)\\)\\s*$', 'm');
  const m = raw.match(re);
  return m ? m[1] : null;
}
function _tupleGet(tuple, key) {
  // Split on top-level commas (no nested parens here in Pal's settings)
  const pairs = tuple.split(',');
  for (const p of pairs) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    if (p.slice(0, eq) === key) {
      let v = p.slice(eq + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return v;
    }
  }
  return undefined;
}
function _tupleSet(tuple, key, value) {
  const isString = typeof value === 'string';
  const isBool = typeof value === 'boolean';
  let formatted;
  if (isBool) formatted = value ? 'True' : 'False';
  else if (isString) formatted = '"' + value.replace(/"/g, '') + '"';
  else if (typeof value === 'number' && !Number.isInteger(value)) formatted = value.toFixed(6);
  else formatted = String(value);

  const pairs = tuple.split(',');
  let found = false;
  for (let i = 0; i < pairs.length; i++) {
    const eq = pairs[i].indexOf('=');
    if (eq < 0) continue;
    if (pairs[i].slice(0, eq) === key) {
      pairs[i] = key + '=' + formatted;
      found = true;
      break;
    }
  }
  if (!found) pairs.push(key + '=' + formatted);
  return pairs.join(',');
}

// ── JSON path (windrose):  "ServerDescription_Persistent.MaxPlayerCount" ──
function _readJsonPath(raw, key) {
  const obj = JSON.parse(raw);
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function _writeJsonPath(raw, key, value) {
  const obj = JSON.parse(raw);
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return JSON.stringify(obj, null, '\t') + '\n';
}

// ── Shell variable (valheim): WORLD_NAME="MadLads" ──
function _readShellVar(raw, name) {
  const re = new RegExp('^' + _escRe(name) + '="([^"]*)"', 'm');
  const m = raw.match(re);
  return m ? m[1] : undefined;
}
function _writeShellVar(raw, name, value) {
  const v = String(value).replace(/"/g, '\\"');
  const re = new RegExp('^(' + _escRe(name) + ')="[^"]*"', 'm');
  if (!re.test(raw)) throw new Error('shell var ' + name + ' not found in start script');
  return raw.replace(re, name + '="' + v + '"');
}

function _escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _xmlEsc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  isSupported,
  getSchema,
  listSupportedGames,
  readCurrent,
  applySettings,
  wipeWorld,
};
