/**
 * Check Anomaly Interior Zones
 */
import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

await connectDB();
const db = getDb();

const anomalyId = '69000d0360596973e9afc4fe';
console.log('🔍 Finding interior zones for Primordial Singularity...\n');

const zones = await db.collection('assets').find({
  assetType: 'zone',
  'hierarchy.parent': new ObjectId(anomalyId)
}).toArray();

console.log('Found zones:', zones.length);
zones.forEach(z => {
  console.log('  Zone ID:', z._id.toString());
  console.log('  Title:', z.title);
  console.log('  Parent:', z.hierarchy?.parent?.toString());
  console.log('');
});

process.exit(0);
