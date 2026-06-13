/**
 * Teleport Characters to Their Docked Galaxies
 *
 * This script moves characters to be near their assigned galaxy
 * instead of being thousands of units away in empty space.
 *
 * Each character will be placed within 100-300 units of their galaxy.
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function teleportCharacters() {
  console.log('🚀 Teleporting characters to their galaxies...\n');

  await connectDB();
  const db = getDb();

  const characters = await db.collection('characters').find({
    'location.type': 'galactic',
    'location.dockedGalaxyId': { $exists: true }
  }).toArray();

  console.log(`Found ${characters.length} characters with galaxy assignments\n`);

  for (const char of characters) {
    const galaxy = await db.collection('assets').findOne({
      _id: new ObjectId(char.location.dockedGalaxyId)
    });

    if (!galaxy) {
      console.log(`⚠️  ${char.name}: No galaxy found with ID ${char.location.dockedGalaxyId}`);
      continue;
    }

    // Calculate current distance
    const dx = char.location.x - galaxy.coordinates.x;
    const dy = char.location.y - galaxy.coordinates.y;
    const dz = char.location.z - galaxy.coordinates.z;
    const oldDist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    // Generate random position 150-250 units from galaxy center
    const distance = 150 + Math.random() * 100; // 150-250 units
    const theta = Math.random() * Math.PI * 2; // Random angle around galaxy
    const phi = (Math.random() - 0.5) * Math.PI; // Random vertical angle

    const newX = galaxy.coordinates.x + distance * Math.cos(phi) * Math.cos(theta);
    const newY = galaxy.coordinates.y + distance * Math.cos(phi) * Math.sin(theta);
    const newZ = galaxy.coordinates.z + distance * Math.sin(phi);

    // Update character position
    await db.collection('characters').updateOne(
      { _id: char._id },
      {
        $set: {
          'location.x': newX,
          'location.y': newY,
          'location.z': newZ,
          'location.lastUpdated': new Date()
        }
      }
    );

    console.log(`✅ ${char.name}:`);
    console.log(`   Galaxy: ${galaxy.title}`);
    console.log(`   Old distance: ${oldDist.toFixed(0)} units (TOO FAR!)`);
    console.log(`   New distance: ${distance.toFixed(0)} units (near galaxy)`);
    console.log(`   New position: (${newX.toFixed(0)}, ${newY.toFixed(0)}, ${newZ.toFixed(0)})\n`);
  }

  console.log('🎉 All characters teleported to their galaxies!');
  console.log('   Characters are now 150-250 units from their galaxy centers.\n');

  process.exit(0);
}

teleportCharacters();
