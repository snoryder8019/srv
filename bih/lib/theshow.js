const BASE = 'https://mlb25.theshow.com/apis';

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'bih-gaming-hub/1.0'
    }
  });
  if (!res.ok) throw new Error(`TheShow API ${res.status}: ${path}`);
  return res.json();
}

// Player Search API — search by name across all player types
function playerSearch(query, page = 1) {
  const p = new URLSearchParams({ query, page: String(page) });
  return apiGet(`/player_search.json?${p}`);
}

// Items API — list cards (type: mlb_card, stadium, equipment, sponsorship, unlockable)
function getItems(options = {}) {
  const p = new URLSearchParams({ type: options.type || 'mlb_card', page: String(options.page || 1) });
  if (options.name) p.set('name', options.name);
  if (options.rarity) p.set('rarity', options.rarity);
  if (options.team) p.set('team', options.team);
  return apiGet(`/items.json?${p}`);
}

// Item API — single card by uuid
function getItem(uuid) {
  return apiGet(`/item.json?uuid=${encodeURIComponent(uuid)}`);
}

// Listings API — market listings
function getListings(options = {}) {
  const p = new URLSearchParams({ type: options.type || 'mlb_card', page: String(options.page || 1) });
  if (options.name) p.set('name', options.name);
  if (options.rarity) p.set('rarity', options.rarity);
  if (options.min_price) p.set('min_price', options.min_price);
  if (options.max_price) p.set('max_price', options.max_price);
  if (options.sort) p.set('sort', options.sort);
  return apiGet(`/listings.json?${p}`);
}

// Listing API — single market listing by uuid
function getListing(uuid) {
  return apiGet(`/listing.json?uuid=${encodeURIComponent(uuid)}`);
}

// Roster Updates API — list of all roster updates
function getRosterUpdates() {
  return apiGet('/roster_updates.json');
}

// Roster Update API — detail + attribute changes for one update
function getRosterUpdate(id) {
  return apiGet(`/roster_update.json?id=${encodeURIComponent(id)}`);
}

// Game History API — a user's game history by username
function getGameHistory(username, page = 1) {
  const p = new URLSearchParams({ username, page: String(page) });
  return apiGet(`/game_history.json?${p}`);
}

// Game Log API — log for a specific game by uuid
function getGameLog(uuid) {
  return apiGet(`/game_log.json?uuid=${encodeURIComponent(uuid)}`);
}

// Captains API — captain card eligibility info
function getCaptains() {
  return apiGet('/captains.json');
}

// Inventory API — user's owned items (requires active session cookie)
async function getInventory(type = 'mlb_card', cookie) {
  const p = new URLSearchParams({ type });
  const r = await fetch(`${BASE}/inventory.json?${p}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'bih-gaming-hub/1.0',
      ...(cookie ? { 'Cookie': cookie } : {})
    }
  });
  if (!r.ok) throw new Error(`TheShow inventory ${r.status}`);
  return r.json();
}

// Meta Data API — series, brands, sets metadata
function getMetaData() {
  return apiGet('/meta_data.json');
}

module.exports = {
  playerSearch,
  getItems,
  getItem,
  getListings,
  getListing,
  getRosterUpdates,
  getRosterUpdate,
  getGameHistory,
  getGameLog,
  getCaptains,
  getInventory,
  getMetaData
};
