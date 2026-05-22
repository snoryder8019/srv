'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// config.json shape:
// {
//   "categoryId":  "...",
//   "dashboardChannelId": "...",
//   "dashboardMessageId": "...",
//   "voiceChannels": { "rust": "...", "valheim": "...", ... }
// }

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { voiceChannels: {} }; }
}

function save(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function update(patch) {
  const cfg = load();
  const next = { ...cfg, ...patch, voiceChannels: { ...cfg.voiceChannels, ...(patch.voiceChannels || {}) } };
  save(next);
  return next;
}

module.exports = { load, save, update, CONFIG_PATH };
