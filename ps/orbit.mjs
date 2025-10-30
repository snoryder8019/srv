import pkg from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const { MongoClient } = pkg;
const client = new MongoClient(process.env.DB_URL);
await client.connect();
const db = client.db(process.env.DB_NAME);

const updates = [
  ['Lumina Prime', {x: 7446, y: 1802, z: 2303}, {vx: 4.43, vy: 0, vz: -14.33}],
  ["Void's Edge", {x: 9961, y: 2009, z: -4212}, {vx: -4.98, vy: 0, vz: -11.78}],
  ['Elysium Cluster', {x: 3200, y: -2400, z: 1600}, {vx: 9.14, vy: 0, vz: -18.28}]
];

console.log("\nSetting orbital velocities...\n");
for (const [title, coords, physics] of updates) {
  await db.collection('assets').updateOne(
    {title, assetType: 'galaxy'},
    {$set: {coordinates: coords, physics, updatedAt: new Date()}}
  );
  console.log(`✅ ${title}`);
}

await client.close();
console.log('\nDone!');
