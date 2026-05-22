'use strict';

// Forwards voiceStateUpdate events into the games portal so the index page
// can flash a toast when someone hops into the designated Games voice channel.
//
// Env:
//   GAMES_VOICE_CHANNEL_ID  — Discord channel ID (or comma-separated list) to watch
//   GAMES_API_BASE          — portal base URL (defaults to https://games.madladslab.com)
//   BRIDGE_SECRET           — shared with the portal (X-Bridge-Secret)

const API_BASE = process.env.GAMES_API_BASE || 'https://games.madladslab.com';
const BRIDGE   = process.env.BRIDGE_SECRET;

function watchedChannelIds() {
  const raw = process.env.GAMES_VOICE_CHANNEL_ID || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function isWatched(channelId) {
  if (!channelId) return false;
  const ids = watchedChannelIds();
  return ids.length === 0 ? false : ids.includes(channelId);
}

async function postVoiceJoin(payload) {
  if (!BRIDGE) {
    console.warn('[voice-bridge] BRIDGE_SECRET missing, skipping POST');
    return;
  }
  try {
    const r = await fetch(API_BASE + '/internal/discord/voice-join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Secret': BRIDGE,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error('[voice-bridge] portal returned', r.status, await r.text().catch(() => ''));
    }
  } catch (e) {
    console.error('[voice-bridge] POST failed:', e.message);
  }
}

function attach(client) {
  const ids = watchedChannelIds();
  if (ids.length === 0) {
    console.warn('[voice-bridge] GAMES_VOICE_CHANNEL_ID unset — voice toasts disabled');
    return;
  }
  console.log('[voice-bridge] watching voice channel(s):', ids.join(', '));

  client.on('voiceStateUpdate', (oldState, newState) => {
    const joinedId = newState.channelId;
    const leftId   = oldState.channelId;

    // Fire only on a transition INTO a watched channel — ignore mutes, deafens,
    // and intra-channel state changes where channelId is unchanged.
    if (!joinedId || joinedId === leftId) return;
    if (!isWatched(joinedId)) return;

    const member = newState.member;
    const user = member
      ? (member.nickname || member.displayName || member.user?.username || 'A user')
      : 'A user';
    const channel = newState.channel?.name || 'Games voice';

    postVoiceJoin({ user, channel });
  });
}

module.exports = { attach };
