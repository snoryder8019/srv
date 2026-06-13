import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);
await client.connect();
const db = client.db(process.env.DB_NAME);
const assets = db.collection('assets');

const star = await assets.findOne({ assetType: 'star', title: 'Lumina Prime' });
console.log('Lumina Prime:');
console.log('  parentGalaxy:', star.parentGalaxy);
console.log('  parentGalaxy type:', typeof star.parentGalaxy);
console.log('  full star:', JSON.stringify(star, null, 2));

await client.close();
process.exit(0);
