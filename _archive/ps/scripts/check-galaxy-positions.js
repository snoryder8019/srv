import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkPositions() {
  await connectDB();
  const db = getDb();

  console.log('\n🌌 Galaxy Positions:\n');
  const galaxies = await db.collection('assets').find({assetType: 'galaxy'}).toArray();
  galaxies.forEach(g => {
    console.log(`   ${g.title.padEnd(25)} @ (${g.coordinates.x.toFixed(0).padStart(5)}, ${g.coordinates.y.toFixed(0).padStart(5)}, ${g.coordinates.z.toFixed(0).padStart(5)})`);
  });

  console.log('\n👤 Character Positions:\n');
  const characters = await db.collection('characters').find({'location.type': 'galactic'}).toArray();
  characters.forEach(c => {
    console.log(`   ${c.name.padEnd(20)} @ (${c.location.x.toFixed(0).padStart(5)}, ${c.location.y.toFixed(0).padStart(5)}, ${c.location.z.toFixed(0).padStart(5)}) - ${c.location.dockedGalaxyName}`);
  });

  process.exit(0);
}

checkPositions();
