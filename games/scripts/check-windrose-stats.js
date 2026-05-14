// One-shot diagnostic: dumps windrose player_stats + recent event-type counts
require('dotenv').config({ path: '/srv/games/.env' });
const { MongoClient } = require('mongodb');

(async () => {
  const c = new MongoClient(process.env.DB_URL);
  await c.connect();
  const db = c.db();

  const players = await db.collection('player_stats')
    .find({ game: 'windrose' }, { projection: { _id: 0, name: 1, sessions: 1, totalPlaytime: 1, firstSeen: 1, lastSeen: 1 } })
    .sort({ totalPlaytime: -1 })
    .limit(15)
    .toArray();
  console.log('=== windrose player_stats ===');
  console.log(JSON.stringify(players, null, 2));

  const since = new Date(Date.now() - 48 * 3600 * 1000);
  const counts = await db.collection('game_events').aggregate([
    { $match: { game: 'windrose', ts: { $gte: since } } },
    { $group: { _id: '$type', count: { $sum: 1 }, last: { $max: '$ts' } } },
    { $sort: { count: -1 } },
  ]).toArray();
  console.log('=== windrose event type counts (last 48h) ===');
  console.log(JSON.stringify(counts, null, 2));

  const recent = await db.collection('game_events')
    .find({ game: 'windrose', type: { $in: ['player_join', 'player_leave'] } })
    .sort({ ts: -1 })
    .limit(8)
    .project({ _id: 0, type: 1, name: 1, ts: 1 })
    .toArray();
  console.log('=== last 8 windrose join/leave events stored ===');
  console.log(JSON.stringify(recent, null, 2));

  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
