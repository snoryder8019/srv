import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
const client = new MongoClient(dbUrl);
await client.connect();
const db = client.db(process.env.DB_NAME);
const assets = db.collection('assets');

// Check the star you clicked on
const starId = '68ffd5c70c7863b5cfafa770';
const star = await assets.findOne({ _id: starId });
console.log('Star:', star?.title);
console.log('Star coordinates:', star?.coordinates);

// Check how many planets have this star as parent
const planets = await assets.find({
  assetType: 'planet',
  parentStar: starId
}).toArray();

console.log(`\nPlanets with parentStar = "${starId}":`, planets.length);

// Check planets with ObjectId parent
const { ObjectId } = await import('mongodb');
const planetsWithObjectId = await assets.find({
  assetType: 'planet',
  parentStar: new ObjectId(starId)
}).toArray();

console.log(`Planets with parentStar = ObjectId("${starId}"):`, planetsWithObjectId.length);

// Sample a few planets to see their parentStar field
const samplePlanets = await assets.find({ assetType: 'planet' }).limit(5).toArray();
console.log('\nSample planets:');
samplePlanets.forEach(p => {
  console.log(`  ${p.title}:`);
  console.log(`    parentStar: ${p.parentStar} (type: ${typeof p.parentStar})`);
  console.log(`    parentStar instanceof ObjectId: ${p.parentStar instanceof ObjectId}`);
});

await client.close();
