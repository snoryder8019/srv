import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function checkGalacticAssets() {
  await connectDB();
  const db = getDb();

  console.log('\n=== Galactic Map Asset Check ===\n');

  const galacticTypes = ['galaxy', 'zone', 'anomaly', 'station'];

  for (const type of galacticTypes) {
    const assets = await db.collection('assets').find({ 
      assetType: type,
      status: 'approved'
    }).toArray();

    console.log('\n' + type.toUpperCase() + ' (' + assets.length + '):');
    
    assets.forEach(asset => {
      const coords = asset.coordinates;
      const hasCoords = coords && (coords.x !== undefined || coords.y !== undefined);
      const coordStr = hasCoords 
        ? '(' + (coords.x || 0).toFixed(0) + ', ' + (coords.y || 0).toFixed(0) + ', ' + (coords.z || 0).toFixed(0) + ')'
        : 'NO COORDS';
      
      console.log('  ' + (hasCoords ? '✅' : '❌') + ' ' + asset.title + ' - ' + coordStr + ' [' + asset.status + ']');
    });
  }

  console.log('\n=== Color Map Check ===');
  console.log('galaxy: 0xbb88ff (purple)');
  console.log('anomaly: 0xff00ff (magenta)');
  console.log('zone: 0x00ffff (cyan)');
  console.log('station: 0xff6600 (orange)');

  process.exit(0);
}

checkGalacticAssets();
