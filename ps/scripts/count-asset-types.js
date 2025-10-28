import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);
await client.connect();
const db = client.db(process.env.DB_NAME);
const assets = db.collection('assets');

const counts = {
  galaxy: await assets.countDocuments({ assetType: 'galaxy' }),
  star: await assets.countDocuments({ assetType: 'star' }),
  planet: await assets.countDocuments({ assetType: 'planet' }),
  orbital: await assets.countDocuments({ assetType: 'orbital' }),
  zone: await assets.countDocuments({ assetType: 'zone' }),
  anomaly: await assets.countDocuments({ assetType: 'anomaly' }),
  station: await assets.countDocuments({ assetType: 'station' })
};

console.log('=== Asset Counts ===');
console.log('Galaxies:', counts.galaxy);
console.log('Stars:', counts.star);
console.log('Planets:', counts.planet);
console.log('Orbitals:', counts.orbital);
console.log('Zones:', counts.zone);
console.log('Anomalies:', counts.anomaly);
console.log('Stations:', counts.station);
console.log('');
console.log('Galactic-level (should show):', counts.galaxy + counts.star + counts.zone + counts.anomaly + counts.station);
console.log('Orbital-level (should NOT show):', counts.planet + counts.orbital);

await client.close();
