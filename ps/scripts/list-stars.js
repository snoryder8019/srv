import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();
const client = new MongoClient(`${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`);
await client.connect();
const db = client.db(process.env.DB_NAME);
const assets = db.collection('assets');
const allStars = await assets.find({ assetType: 'star' }).toArray();
console.log('All stars with IDs:');
allStars.forEach(s => console.log(`  ${s.title}: ${s._id}`));

// Count planets per star
console.log('\nPlanets per star:');
for (const star of allStars) {
  const planetCount = await assets.countDocuments({
    assetType: 'planet',
    parentStar: star._id.toString()
  });
  if (planetCount > 0) {
    console.log(`  ${star.title}: ${planetCount} planets`);
  }
}

await client.close();
