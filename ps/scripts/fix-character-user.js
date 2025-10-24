/**
 * Fix Character User Association
 * Updates character's userId to point to the correct user
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function fixCharacterUser() {
  try {
    await connectDB();
    const db = getDb();

    const characterName = 'ScooterMcBooter';
    const correctUsername = 'scootermcboot';

    console.log(`\n🔧 Fixing user association for character: "${characterName}"\n`);

    // Find the character
    const character = await db.collection('characters').findOne({
      name: new RegExp(characterName, 'i')
    });

    if (!character) {
      console.log('❌ Character not found!');
      process.exit(1);
    }

    console.log(`✅ Character found: ${character.name}`);
    console.log(`   Current userId: ${character.userId}`);

    // Find the correct user
    const correctUser = await db.collection('users').findOne({
      username: new RegExp(correctUsername, 'i')
    });

    if (!correctUser) {
      console.log(`❌ User "${correctUsername}" not found!`);
      process.exit(1);
    }

    console.log(`✅ Correct user found: ${correctUser.username}`);
    console.log(`   User ID: ${correctUser._id}`);

    // Update the character's userId
    const result = await db.collection('characters').updateOne(
      { _id: character._id },
      {
        $set: {
          userId: correctUser._id,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`\n✅ Successfully updated character's userId!`);
      console.log(`   Character: ${character.name}`);
      console.log(`   Old userId: ${character.userId}`);
      console.log(`   New userId: ${correctUser._id}`);
      console.log(`   Owner: ${correctUser.username}`);
    } else {
      console.log('\n⚠️  No changes made (userId might already be correct)');
    }

    // Verify the fix
    const updatedCharacter = await db.collection('characters').findOne({ _id: character._id });
    console.log('\n📋 Verification:');
    console.log(`   Character userId: ${updatedCharacter.userId}`);
    console.log(`   User _id:         ${correctUser._id}`);
    console.log(`   Match: ${String(updatedCharacter.userId) === String(correctUser._id) ? '✅' : '❌'}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixCharacterUser();
