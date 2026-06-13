import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

await connectDB();
const db = getDb();
const zone = await db.collection('assets').findOne({ _id: new ObjectId('690a7a25134a4ef9aab3d585') });
console.log(JSON.stringify(zone, null, 2));
process.exit(0);
