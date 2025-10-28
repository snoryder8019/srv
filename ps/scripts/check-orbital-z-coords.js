import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function checkOrbitalCoords() {
  await connectDB();
  const db = getDb();

  console.log('\n=== Checking Orbital Body Z Coordinates ===\n');

  const orbitals = await db.collection('assets').find({ 
    assetType: { $in: ['planet', 'orbital', 'star'] }
  }).toArray();

  let missingZ = 0;
  let hasZ = 0;

  orbitals.forEach(orbital => {
    if (!orbital.coordinates || orbital.coordinates.z === undefined || orbital.coordinates.z === null) {
      console.log('❌ Missing Z: ' + orbital.assetType + ' - ' + orbital.title);
      missingZ++;
    } else {
      hasZ++;
    }
  });

  console.log('\n📊 Summary:');
  console.log('With Z coordinate: ' + hasZ);
  console.log('Missing Z coordinate: ' + missingZ);

  process.exit(0);
}

checkOrbitalCoords();
