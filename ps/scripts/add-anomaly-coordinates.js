/**
 * Add Coordinates to Anomalies
 * Makes anomalies appear on the galactic map as interstellar objects
 */

import { getDb, connectDB } from '../plugins/mongo/mongo.js';

async function addAnomalyCoordinates() {
  try {
    await connectDB();
    const db = getDb();

    // Find all anomalies
    const anomalies = await db.collection('assets').find({ assetType: 'anomaly' }).toArray();

    console.log(`Found ${anomalies.length} anomaly assets\n`);

    for (const anomaly of anomalies) {
      console.log(`Anomaly: ${anomaly.title || anomaly.name}`);
      console.log(`  ID: ${anomaly._id}`);
      console.log(`  Current coordinates: ${JSON.stringify(anomaly.coordinates)}`);

      // If no coordinates, add them
      if (!anomaly.coordinates || !anomaly.coordinates.x) {
        // Generate random coordinates in interstellar space
        // Place them spread out across the universe
        const coords = {
          x: Math.floor(Math.random() * 8000) - 4000, // -4000 to 4000
          y: Math.floor(Math.random() * 4000) - 2000, // -2000 to 2000
          z: Math.floor(Math.random() * 6000) - 3000  // -3000 to 3000
        };

        console.log(`  Adding coordinates: ${JSON.stringify(coords)}`);

        await db.collection('assets').updateOne(
          { _id: anomaly._id },
          {
            $set: {
              coordinates: coords,
              renderData: {
                color: '#ff00ff',  // Bright magenta for visibility
                size: 40,           // Large size
                glow: true,
                glowColor: '#ff00ff'
              }
            }
          }
        );

        console.log(`  ✅ Updated with coordinates\n`);
      } else {
        console.log(`  Already has coordinates, skipping\n`);
      }
    }

    // List final state
    console.log('\n=== Final Anomaly Positions ===');
    const updatedAnomalies = await db.collection('assets')
      .find({ assetType: 'anomaly' })
      .toArray();

    updatedAnomalies.forEach(a => {
      console.log(`${a.title || a.name}:`);
      console.log(`  Position: (${a.coordinates.x}, ${a.coordinates.y}, ${a.coordinates.z})`);
      console.log(`  Render: ${JSON.stringify(a.renderData)}`);
    });

    console.log('\n✅ All anomalies now have galactic coordinates!');
    console.log('🗺️  They will appear on the galactic map as interstellar objects');
    console.log('🎯 Players can select them to land as zones');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addAnomalyCoordinates();
