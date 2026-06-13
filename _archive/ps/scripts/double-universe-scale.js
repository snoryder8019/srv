import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

async function doubleUniverseScale() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db = client.db(process.env.DB_NAME);
    const assetsCollection = db.collection('assets');

    console.log('\n=== DOUBLING UNIVERSE SCALE ===\n');

    // Get all assets with coordinates
    const assets = await assetsCollection.find({
      coordinates: { $exists: true }
    }).toArray();

    console.log(`📊 Found ${assets.length} assets with coordinates`);

    let updatedCount = 0;

    for (const asset of assets) {
      const oldX = asset.coordinates.x || 0;
      const oldY = asset.coordinates.y || 0;
      const oldZ = asset.coordinates.z || 0;

      // Double all coordinates
      const newX = oldX * 2;
      const newY = oldY * 2;
      const newZ = oldZ * 2;

      const result = await assetsCollection.updateOne(
        { _id: asset._id },
        {
          $set: {
            'coordinates.x': newX,
            'coordinates.y': newY,
            'coordinates.z': newZ
          }
        }
      );

      if (result.modifiedCount > 0) {
        updatedCount++;
        console.log(`  ✓ ${asset.assetType} "${asset.title}": (${Math.round(oldX)}, ${Math.round(oldY)}, ${Math.round(oldZ)}) → (${Math.round(newX)}, ${Math.round(newY)}, ${Math.round(newZ)})`);
      }
    }

    console.log(`\n✅ Updated ${updatedCount}/${assets.length} assets`);

    // Show new universe bounds
    const allAssets = await assetsCollection.find({
      coordinates: { $exists: true }
    }).toArray();

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    allAssets.forEach(asset => {
      const x = asset.coordinates.x || 0;
      const y = asset.coordinates.y || 0;
      const z = asset.coordinates.z || 0;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });

    const universeWidth = maxX - minX;
    const universeHeight = maxY - minY;
    const universeDepth = maxZ - minZ;

    console.log(`\n📏 New universe dimensions:`);
    console.log(`   X: ${Math.round(minX)} to ${Math.round(maxX)} (width: ${Math.round(universeWidth)})`);
    console.log(`   Y: ${Math.round(minY)} to ${Math.round(maxY)} (height: ${Math.round(universeHeight)})`);
    console.log(`   Z: ${Math.round(minZ)} to ${Math.round(maxZ)} (depth: ${Math.round(universeDepth)})`);

    // Calculate new center
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    console.log(`\n🎯 New universe center: (${Math.round(centerX)}, ${Math.round(centerY)}, ${Math.round(centerZ)})`);

    console.log('\n=== SCALE DOUBLING COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Error during scale doubling:', error);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Database connection closed');
  }
}

// Run the script
doubleUniverseScale().catch(console.error);
