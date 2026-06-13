import { getDb, connectDB } from '../plugins/mongo/mongo.js';
await connectDB();
const db = getDb();
const colony = await db.collection('assets').findOne({title: 'Starship Colony'});
console.log('Starship Colony:', JSON.stringify(colony, null, 2));
const chars = await db.collection('characters').find({}, {name: 1, 'location.x': 1, 'location.y': 1, 'location.z': 1, 'location.zone': 1, 'location.assetId': 1}).toArray();
console.log('\nCharacter locations:', JSON.stringify(chars, null, 2));
process.exit(0);
