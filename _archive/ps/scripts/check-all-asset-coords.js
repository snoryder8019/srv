/**
 * Check All Asset Coordinates
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new MongoClient(process.env.DB_URL);

async function checkAllCoords() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    const assets = await db.collection('assets')
      .find({ status: 'approved' })
      .project({ assetType: 1, coordinates: 1 })
      .toArray();

    const byType = {};
    assets.forEach(asset => {
      const type = asset.assetType || 'unknown';
      const coords = asset.coordinates || {};
      const hasCoords = (coords.x !== 0 && coords.x !== undefined) || (coords.y !== 0 && coords.y !== undefined);

      if (!byType[type]) {
        byType[type] = { total: 0, withCoords: 0 };
      }

      byType[type].total++;
      if (hasCoords) {
        byType[type].withCoords++;
      }
    });

    console.log('\nAsset Types and Coordinates:\n');
    console.log('Type              Total  With Coords  Missing');
    console.log('-----------------------------------------------');

    Object.keys(byType).sort().forEach(type => {
      const { total, withCoords } = byType[type];
      const missing = total - withCoords;
      console.log(`${type.padEnd(15)} ${String(total).padStart(6)} ${String(withCoords).padStart(12)} ${String(missing).padStart(8)}`);
    });

    const totalAssets = Object.values(byType).reduce((sum, t) => sum + t.total, 0);
    const totalWithCoords = Object.values(byType).reduce((sum, t) => sum + t.withCoords, 0);
    const totalMissing = totalAssets - totalWithCoords;

    console.log('-----------------------------------------------');
    console.log(`${'TOTAL'.padEnd(15)} ${String(totalAssets).padStart(6)} ${String(totalWithCoords).padStart(12)} ${String(totalMissing).padStart(8)}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkAllCoords();
