/**
 * Assign Galactic Coordinates to Orbitals and Anomalies
 * Distributes assets across the 5000x5000 galactic map
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

// Map dimensions
const MAP_WIDTH = 5000;
const MAP_HEIGHT = 5000;
const PADDING = 300; // Avoid edges

// Galaxy positions for reference
const GALAXIES = {
  'Stellar Crown': { x: 2500, y: 1000 },
  'Andromeda Spiral': { x: 4000, y: 2500 },
  'Elysium Cluster': { x: 2500, y: 4000 },
  'Crimson Nebula Galaxy': { x: 1000, y: 2500 },
  'Void Edge Galaxy': { x: 2500, y: 2500 }
};

function randomCoordinate(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function getRandomPosition() {
  return {
    x: randomCoordinate(PADDING, MAP_WIDTH - PADDING),
    y: randomCoordinate(PADDING, MAP_HEIGHT - PADDING),
    z: 0
  };
}

async function assignCoordinates() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    console.log('🗺️  Assigning Galactic Coordinates\n');

    // Get all assets that need coordinates
    const needsCoords = await db.collection('assets')
      .find({
        status: 'approved',
        assetType: { $in: ['orbital', 'anomaly'] },
        $or: [
          { 'coordinates.x': { $exists: false } },
          { 'coordinates.y': { $exists: false } },
          { $and: [{ 'coordinates.x': 0 }, { 'coordinates.y': 0 }] }
        ]
      })
      .toArray();

    console.log(`Found ${needsCoords.length} assets without coordinates\n`);

    let updated = 0;

    for (const asset of needsCoords) {
      const position = getRandomPosition();

      const result = await db.collection('assets').updateOne(
        { _id: asset._id },
        {
          $set: {
            coordinates: position,
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ ${asset.title.padEnd(30)} (${position.x}, ${position.y})`);
        updated++;
      }
    }

    console.log(`\n✅ Updated ${updated} assets with galactic coordinates`);

    // Summary
    console.log('\n📊 Summary by Type:\n');

    const orbitals = await db.collection('assets')
      .countDocuments({
        status: 'approved',
        assetType: 'orbital',
        $or: [
          { 'coordinates.x': { $ne: 0 } },
          { 'coordinates.y': { $ne: 0 } }
        ]
      });

    const anomalies = await db.collection('assets')
      .countDocuments({
        status: 'approved',
        assetType: 'anomaly',
        $or: [
          { 'coordinates.x': { $ne: 0 } },
          { 'coordinates.y': { $ne: 0 } }
        ]
      });

    console.log(`Orbitals with coordinates:  ${orbitals}`);
    console.log(`Anomalies with coordinates: ${anomalies}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

assignCoordinates();
