import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function fixAnomalyCoords() {
  await connectDB();
  const db = getDb();

  console.log('\n=== Fixing Anomaly Coordinates ===\n');

  // Get all anomalies without coordinates
  const anomalies = await db.collection('assets').find({
    assetType: 'anomaly'
  }).toArray();

  console.log('Total anomalies:', anomalies.length);

  let fixed = 0;
  for (const anomaly of anomalies) {
    if (!anomaly.coordinates || !anomaly.coordinates.x || !anomaly.coordinates.y) {
      // Place anomalies in interesting locations around the map
      const coords = {
        x: (Math.random() - 0.5) * 1500,
        y: (Math.random() - 0.5) * 1500,
        z: (Math.random() - 0.5) * 200
      };

      await db.collection('assets').updateOne(
        { _id: anomaly._id },
        {
          $set: {
            coordinates: coords,
            status: 'approved'
          }
        }
      );

      console.log('✅ Fixed: ' + anomaly.title + ' at (' + coords.x.toFixed(1) + ', ' + coords.y.toFixed(1) + ', ' + coords.z.toFixed(1) + ')');
      fixed++;
    } else {
      console.log('✓ Has coords: ' + anomaly.title);
    }
  }

  console.log('\n📊 Summary:');
  console.log('Fixed: ' + fixed);
  console.log('Total anomalies: ' + anomalies.length);

  process.exit(0);
}

fixAnomalyCoords();
