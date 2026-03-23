const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Steam API parse error')); }
      });
    }).on('error', reject);
  });
}

const KEY = () => process.env.STEAM_API_KEY;

// Resolve a vanity URL (custom Steam username) to SteamID64
async function resolveVanityUrl(vanityUrl) {
  if (!KEY()) throw new Error('STEAM_API_KEY not configured');
  const data = await get(
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${KEY()}&vanityurl=${encodeURIComponent(vanityUrl)}`
  );
  if (data.response.success !== 1) throw new Error('Steam user not found');
  return data.response.steamid;
}

// Get player summary for a SteamID64
async function getPlayerSummary(steamId64) {
  const data = await get(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${KEY()}&steamids=${steamId64}`
  );
  const player = data.response?.players?.[0];
  if (!player) throw new Error('Player not found');

  const PERSONA_STATE = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play'];
  return {
    steamId: player.steamid,
    displayName: player.personaname,
    avatar: player.avatarmedium,
    profileUrl: player.profileurl,
    status: PERSONA_STATE[player.personastate] || 'Offline',
    currentGame: player.gameextrainfo || null,
    currentGameId: player.gameid || null,
    lastOnline: player.lastlogoff ? new Date(player.lastlogoff * 1000).toISOString() : null,
    visibility: player.communityvisibilitystate, // 1=private, 3=public
  };
}

// Get recently played games (last 2 weeks)
async function getRecentGames(steamId64) {
  const data = await get(
    `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${KEY()}&steamid=${steamId64}&count=5`
  );
  const games = data.response?.games || [];
  return games.map(g => ({
    appId: g.appid,
    name: g.name,
    playtime2Weeks: Math.round(g.playtime_2weeks / 60 * 10) / 10, // hours
    playtimeTotal: Math.round(g.playtime_forever / 60 * 10) / 10, // hours
    icon: g.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
      : null,
  }));
}

// Full activity fetch for a vanity URL — resolves ID then fetches summary + recent games
async function getActivity(vanityUrl) {
  if (!KEY()) return { error: 'Steam API not configured — add STEAM_API_KEY to .env' };
  try {
    const steamId = await resolveVanityUrl(vanityUrl);
    const [summary, recentGames] = await Promise.all([
      getPlayerSummary(steamId),
      getRecentGames(steamId),
    ]);
    return { steamId, summary, recentGames };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { getActivity, resolveVanityUrl, getPlayerSummary, getRecentGames };
