import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);

await client.connect();
const db = client.db(process.env.DB_NAME);
const assets = db.collection('assets');

// Get the star from the URL
const starIdString = '69000d0360596973e9afc502';
const star = await assets.findOne({ _id: new ObjectId(starIdString) });

console.log('Star:', star?.title || 'NOT FOUND');
if (star) {
  console.log('  _id:', star._id);
  console.log('  coordinates:', JSON.stringify(star.coordinates));
  console.log('  coordinates3D:', JSON.stringify(star.coordinates3D));
}
console.log();

// Get planets for this star
const planets = await assets.find({
  assetType: 'planet',
  parentStar: starIdString
}).limit(5).toArray();

console.log(`Found ${planets.length} planets`);
console.log('\nSample planets:');
planets.forEach(p => {
  console.log(`\n${p.title}:`);
  console.log('  _id:', p._id);
  console.log('  parentStar:', p.parentStar);
  console.log('  coordinates:', JSON.stringify(p.coordinates));
  console.log('  coordinates3D:', JSON.stringify(p.coordinates3D));
  console.log('  orbitRadius:', p.orbitRadius);

  // Check which coord field has data
  const hasCoords = p.coordinates && (p.coordinates.x || p.coordinates.y || p.coordinates.z);
  const hasCoords3D = p.coordinates3D && (p.coordinates3D.x || p.coordinates3D.y || p.coordinates3D.z);
  console.log('  HAS coordinates:', hasCoords ? 'YES' : 'NO');
  console.log('  HAS coordinates3D:', hasCoords3D ? 'YES' : 'NO');
});

await client.close();
