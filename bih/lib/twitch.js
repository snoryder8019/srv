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

module.exports = { getLiveStreams };
