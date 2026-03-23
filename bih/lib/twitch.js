const https = require('https');

let appToken = null;
let tokenExpiry = 0;

/**
 * Get a Twitch app access token (client credentials flow).
 * Caches the token until it expires.
 */
function getAppToken() {
  return new Promise((resolve, reject) => {
    if (appToken && Date.now() < tokenExpiry) return resolve(appToken);

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reject(new Error('TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET not set'));
    }

    const postData = `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`;
    const req = https.request({
      hostname: 'id.twitch.tv',
      path: '/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.access_token) {
            appToken = data.access_token;
            // Expire 5 min early to be safe
            tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
            resolve(appToken);
          } else {
            reject(new Error('Twitch token error: ' + body));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Check which Twitch usernames are currently live.
 * @param {string[]} userLogins - Array of Twitch usernames
 * @returns {Promise<Object[]>} - Array of stream objects for live users
 */
async function getLiveStreams(userLogins) {
  if (!userLogins.length) return [];

  const token = await getAppToken();
  const clientId = process.env.TWITCH_CLIENT_ID;

  // Twitch API supports up to 100 user_login params per request
  const params = userLogins.map(u => `user_login=${encodeURIComponent(u)}`).join('&');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twitch.tv',
      path: `/helix/streams?${params}`,
      method: 'GET',
      headers: {
        'Client-Id': clientId,
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.data) {
            resolve(data.data.map(s => ({
              userName: s.user_login,
              displayName: s.user_name,
              title: s.title,
              gameName: s.game_name,
              viewerCount: s.viewer_count,
              thumbnail: s.thumbnail_url
                .replace('{width}', '440')
                .replace('{height}', '248'),
              startedAt: s.started_at
            })));
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Get user info + channel data for a single login.
 * Returns: id, login, displayName, profileImage, description, viewCount, followerCount (null if unavailable)
 */
async function getChannelInfo(login) {
  const token = await getAppToken();
  const clientId = process.env.TWITCH_CLIENT_ID;

  // Step 1: get user id + profile
  const userInfo = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twitch.tv',
      path: `/helix/users?login=${encodeURIComponent(login)}`,
      method: 'GET',
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });

  const user = userInfo.data?.[0];
  if (!user) return null;

  // Step 2: get recent VODs
  const vodsData = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twitch.tv',
      path: `/helix/videos?user_id=${user.id}&type=archive&first=3`,
      method: 'GET',
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });

  const vods = (vodsData.data || []).map(v => ({
    id: v.id,
    title: v.title,
    duration: v.duration,
    viewCount: v.view_count,
    publishedAt: v.published_at,
    thumbnail: v.thumbnail_url
      .replace('%{width}', '320')
      .replace('%{height}', '180'),
    url: v.url,
  }));

  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImage: user.profile_image_url,
    description: user.description,
    viewCount: user.view_count,
    createdAt: user.created_at,
    recentVods: vods,
  };
}

module.exports = { getLiveStreams, getChannelInfo };
