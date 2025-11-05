import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function checkDistance() {
  await connectDB();
  const db = getDb();

  // Get Faithbender's position and nearest galaxy
  const char = await db.collection('characters').findOne({name: 'Faithbender'});
  console.log('\n🎮 Faithbender:');
  console.log('   Location:', char.location.x.toFixed(0), char.location.y.toFixed(0), char.location.z.toFixed(0));
  console.log('   Docked at:', char.location.dockedGalaxyName);

  // Get that galaxy's position
  const galaxy = await db.collection('assets').findOne({_id: new ObjectId(char.location.dockedGalaxyId)});
  console.log('\n🌌 ' + galaxy.title + ':');
  console.log('   Position:', galaxy.coordinates.x.toFixed(0), galaxy.coordinates.y.toFixed(0), galaxy.coordinates.z.toFixed(0));

  // Calculate distance
  const dx = char.location.x - galaxy.coordinates.x;
  const dy = char.location.y - galaxy.coordinates.y;
  const dz = char.location.z - galaxy.coordinates.z;
  const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
  console.log('\n📏 Distance: ' + dist.toFixed(0) + ' units');
  console.log('   This is TOO FAR! Characters should spawn NEAR their galaxy.\n');

  // Find ACTUAL nearest galaxy
  const galaxies = await db.collection('assets').find({assetType: 'galaxy'}).toArray();
  let nearestGalaxy = null;
  let minDist = Infinity;

  for (const g of galaxies) {
    const d = Math.sqrt(
      (char.location.x - g.coordinates.x)**2 +
      (char.location.y - g.coordinates.y)**2 +
      (char.location.z - g.coordinates.z)**2
    );
    if (d < minDist) {
      minDist = d;
      nearestGalaxy = g;
    }
  }

  console.log('🔍 ACTUAL nearest galaxy: ' + nearestGalaxy.title);
  console.log('   Distance: ' + minDist.toFixed(0) + ' units');
  console.log('   Position:', nearestGalaxy.coordinates.x.toFixed(0), nearestGalaxy.coordinates.y.toFixed(0), nearestGalaxy.coordinates.z.toFixed(0));

  process.exit(0);
}

checkDistance();
