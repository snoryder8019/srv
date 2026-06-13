import pkg from 'mongodb';
const { MongoClient } = pkg;

const client = new MongoClient('mongodb://localhost:27017/');
await client.connect();
const db = client.db('projectStringborne');

const updates = [
  ['Lumina Prime', {x: 7446, y: 1802, z: 2303}, {vx: -5, vy: 15, vz: -3}],
  ["Void's Edge", {x: 9961, y: 2009, z: -4212}, {vx: 8, vy: 12, vz: 5}],
  ['Elysium Cluster', {x: 3200, y: -2400, z: 1600}, {vx: 12, vy: -5, vz: 8}]
];

for (const [title, coords, physics] of updates) {
  await db.collection('assets').updateOne(
    {title, assetType: 'galaxy'},
    {$set: {coordinates: coords, physics, updatedAt: new Date()}}
  );
  console.log(`✅ ${title}`);
}

await client.close();
console.log('Done!');
