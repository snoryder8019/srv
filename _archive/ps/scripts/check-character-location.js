/**
 * Check Specific Character Location
 * Debug tool to inspect a character's location data
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function checkCharacterLocation() {
  try {
    await connectDB();
    const db = getDb();

    // Get character by name (case insensitive)
    const characterName = process.argv[2] || 'ScooterMcBooter';

    console.log(`\n🔍 Looking for character: "${characterName}"\n`);

    const character = await db.collection('characters').findOne({
      name: new RegExp(characterName, 'i')
    });

    if (!character) {
      console.log('❌ Character not found!');
      process.exit(1);
    }

    console.log('✅ Character found!\n');
    console.log('📋 Full Character Object:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(character, null, 2));
    console.log('='.repeat(60));

    console.log('\n📍 Location Analysis:');
    console.log('='.repeat(60));

    if (character.location) {
      console.log('✅ Location field exists');
      console.log(`   Type: ${typeof character.location}`);
      console.log(`   Value:`, character.location);

      if (typeof character.location === 'object') {
        console.log('\n   Fields in location object:');
        for (const [key, value] of Object.entries(character.location)) {
          console.log(`   - ${key}: ${value} (${typeof value})`);
        }

        // Check for valid coordinates
        const hasX = typeof character.location.x === 'number';
        const hasY = typeof character.location.y === 'number';

        console.log('\n   Validation:');
        console.log(`   - Has X coordinate: ${hasX ? '✅' : '❌'} ${hasX ? `(${character.location.x})` : ''}`);
        console.log(`   - Has Y coordinate: ${hasY ? '✅' : '❌'} ${hasY ? `(${character.location.y})` : ''}`);

        if (hasX && hasY) {
          console.log(`\n   ✅ Location is VALID: (${character.location.x}, ${character.location.y})`);
        } else {
          console.log('\n   ❌ Location is INVALID: Missing x or y coordinates');
        }
      } else {
        console.log('   ❌ Location is not an object!');
      }
    } else {
      console.log('❌ No location field!');
    }

    console.log('\n👤 User Association:');
    console.log('='.repeat(60));
    console.log(`User ID: ${character.userId || 'N/A'}`);

    if (character.userId) {
      const user = await db.collection('users').findOne({ _id: character.userId });
      if (user) {
        console.log(`Username: ${user.username}`);
        console.log(`Email: ${user.email}`);
        console.log(`User Role: ${user.userRole || 'N/A'}`);
      }
    }

    console.log('\n🏠 Home Hub:');
    console.log('='.repeat(60));
    if (character.homeHub) {
      console.log(JSON.stringify(character.homeHub, null, 2));
    } else {
      console.log('❌ No home hub set');
    }

    console.log('\n🧭 Navigation:');
    console.log('='.repeat(60));
    if (character.navigation) {
      console.log(JSON.stringify(character.navigation, null, 2));
    } else {
      console.log('❌ No navigation data');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkCharacterLocation();
