import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { collections } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

await connectDB();
const db = getDb();
const count = await db.collection(collections.assets).countDocuments({x: {$exists: true}});
console.log('Assets with x coordinate:', count);
const sample = await db.collection(collections.assets).findOne({x: {$exists: true}}, {projection: {title: 1, x: 1, y: 1, vx: 1, vy: 1}});
if (sample) console.log('Sample:', JSON.stringify(sample, null, 2));
process.exit(0);
