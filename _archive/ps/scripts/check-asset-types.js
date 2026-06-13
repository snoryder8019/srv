import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function checkAssetTypes() {
  await connectDB();
  const db = getDb();

  const assets = await db.collection('assets').find({}).project({ assetType: 1, title: 1 }).toArray();
  const typeGroups = {};

  assets.forEach(asset => {
    const type = asset.assetType || 'unknown';
    if (!typeGroups[type]) typeGroups[type] = [];
    typeGroups[type].push(asset.title);
  });

  console.log('\n=== Asset Types Found ===\n');
  Object.keys(typeGroups).sort().forEach(type => {
    const examples = typeGroups[type].slice(0, 3).join(', ');
    const more = typeGroups[type].length > 3 ? '...' : '';
    console.log(type + ' (' + typeGroups[type].length + '): ' + examples + more);
  });

  process.exit(0);
}

checkAssetTypes();
