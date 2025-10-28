#!/usr/bin/env node
/**
 * Initialize Planet System Collections
 * Creates indexes for new collections: planetModifications, planetObjects, spriteAtlases
 */

import { connectDB } from '../plugins/mongo/mongo.js';
import PlanetModification from '../api/v1/models/PlanetModification.js';
import PlanetObject from '../api/v1/models/PlanetObject.js';
import SpriteAtlas from '../api/v1/models/SpriteAtlas.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

async function initCollections() {
  console.log('🚀 Initializing Planet System Collections...\n');

  try {
    // Use the existing connectDB function
    const db = await connectDB();

    // Create indexes for each collection
    console.log('\n📋 Creating indexes...');

    await PlanetModification.createIndexes();
    await PlanetObject.createIndexes();
    await SpriteAtlas.createIndexes();

    console.log('\n✨ All collections initialized successfully!');
    console.log('\n📊 Collection Summary:');
    console.log('  • planetModifications - Tracks terrain changes by players');
    console.log('  • planetObjects - Stores placed objects (buildings, spaceships, etc.)');
    console.log('  • spriteAtlases - Manages sprite packs for rendering');

    console.log('\n💾 Previous System:');
    console.log('  • planetChunks (DELETED) - 462MB freed');
    console.log('  • Chunks now generated procedurally on-demand');

    console.log('\n🎯 Next Steps:');
    console.log('  1. Upload default sprite atlases');
    console.log('  2. Test sprite rendering');
    console.log('  3. Implement object placement UI');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

initCollections();
