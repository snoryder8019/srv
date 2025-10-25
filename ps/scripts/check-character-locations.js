import { MongoClient, ObjectId } from 'mongodb';

const DB_URL = process.env.DB_URL || 'mongodb://localhost:27017';
const DB_NAME = 'projectStringborne';

async function checkCharacterLocations() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);

    // Get all characters
    const characters = await db.collection('characters').find({}).toArray();

    console.log(`\n📊 Found ${characters.length} characters\n`);

    for (const char of characters) {
      console.log(`Character: ${char.name} (${char._id})`);
      console.log(`  User ID: ${char.userId}`);
      console.log(`  Location:`, JSON.stringify(char.location, null, 2));

      if (char.location && char.location.assetId) {
        // Try to find the asset
        const asset = await db.collection('assets').findOne(
          { _id: new ObjectId(char.location.assetId) }
        );

        if (asset) {
          console.log(`  ✅ Asset Found: ${asset.title} (${asset.assetType})`);
        } else {
          console.log(`  ❌ Asset NOT FOUND for ID: ${char.location.assetId}`);
        }
      } else {
        console.log(`  ⚠️  No assetId in location`);
      }

      if (char.navigation && char.navigation.isInTransit) {
        console.log(`  🚀 IN TRANSIT`);
        console.log(`  Navigation:`, JSON.stringify(char.navigation, null, 2));
      }

      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

checkCharacterLocations();
