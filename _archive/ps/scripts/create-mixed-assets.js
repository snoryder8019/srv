/**
 * Create mixed sample assets and orbital bodies
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = 'projectStringborne';

const ASSET_TYPES = ['item', 'character', 'orbital', 'galaxy', 'anomaly', 'zone'];

const SAMPLE_ITEMS = [
  { name: 'Quantum Blade', description: 'A sword that exists in multiple dimensions simultaneously', lore: 'Forged in the quantum forge of the Silicates' },
  { name: 'Neural Implant', description: 'Enhances cognitive abilities and string manipulation', lore: 'Created by the Lanterns to interface with technology' },
  { name: 'Faith Crystal', description: 'Channels divine energy for miraculous effects', lore: 'Sacred artifact of the Devan people' },
  { name: 'War Banner', description: 'Inspires allies and intimidates enemies', lore: 'Carried by Human commanders since ancient times' },
  { name: 'Chrono Compass', description: 'Navigate through time and space', lore: 'A mysterious device from the Time String domain' }
];

const SAMPLE_CHARACTERS = [
  { name: 'Commander Vex', description: 'Elite War String warrior', backstory: 'Rose through ranks during the faction wars', species: 'Human' },
  { name: 'Arch-Priest Lumis', description: 'High cleric of the Faith String', backstory: 'Devoted life to understanding divine mysteries', species: 'Devan' },
  { name: 'Technomancer Zira', description: 'Master of Tech String manipulation', backstory: 'Pioneered new forms of technological advancement', species: 'Lantern' },
  { name: 'Chronomancer Kael', description: 'Time String specialist', backstory: 'Studies the fabric of time itself', species: 'Silicate' }
];

const SAMPLE_ZONES = [
  { name: 'Nebula Wastes', description: 'Dangerous region filled with cosmic radiation', hazards: ['radiation', 'asteroids'] },
  { name: 'Crystal Fields', description: 'Beautiful crystalline formations with mysterious properties', resources: ['crystals', 'minerals'] },
  { name: 'Dark Sector', description: 'Unexplored region shrouded in darkness', danger: 'extreme' },
  { name: 'Trade Route Alpha', description: 'Busy commercial corridor', traffic: 'high' }
];

const SAMPLE_ANOMALIES = [
  { name: 'Void Tear', description: 'A rupture in spacetime itself', threat: 'critical' },
  { name: 'Energy Vortex', description: 'Swirling mass of pure energy', harvestable: true },
  { name: 'Ancient Beacon', description: 'Mysterious signal from unknown origin', age: 'ancient' }
];

const ORBITAL_BODIES = [
  { name: 'Titan Prime', type: 'moon', description: 'Massive moon with underground oceans', resources: ['water', 'minerals'] },
  { name: 'Forge World Delta', type: 'industrial', description: 'Artificial world dedicated to manufacturing', production: 'high' },
  { name: 'Haven Station', type: 'station', description: 'Neutral trading outpost', services: ['trade', 'repair', 'medical'] },
  { name: 'Crystal Moon Aria', type: 'moon', description: 'Moon covered in luminescent crystals', beauty: 'extreme' },
  { name: 'Defense Platform Omega', type: 'station', description: 'Military fortress protecting trade routes', armament: 'heavy' },
  { name: 'Research Outpost Kepler', type: 'station', description: 'Scientific research facility', focus: 'temporal studies' },
  { name: 'Mining Colony Gamma', type: 'colony', description: 'Resource extraction settlement', production: 'minerals' },
  { name: 'Pilgrim Moon', type: 'moon', description: 'Sacred site for Faith String believers', significance: 'religious' },
  { name: 'Tech Hub Nexus', type: 'station', description: 'Advanced technological development center', innovation: 'cutting-edge' },
  { name: 'Warfront Station', type: 'station', description: 'Military staging ground', purpose: 'strategic' },
  { name: 'Frozen Moon Glacius', type: 'moon', description: 'Ice-covered moon with ancient secrets', temperature: 'extreme-cold' },
  { name: 'Paradise Ring', type: 'habitat', description: 'Luxury residential orbital ring', class: 'elite' }
];

async function createMixedAssets() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const assetsCollection = db.collection('assets');
    const usersCollection = db.collection('users');

    // Get a user to assign as creator (or use system)
    let userId = 'system';
    const user = await usersCollection.findOne({});
    if (user) {
      userId = user._id;
    }

    const assetsToCreate = [];

    // Create items
    SAMPLE_ITEMS.forEach((item, index) => {
      assetsToCreate.push({
        userId: userId,
        title: item.name,
        name: item.name,
        description: item.description,
        assetType: 'item',
        type: 'item',
        lore: item.lore,
        status: index % 3 === 0 ? 'submitted' : 'approved',
        images: { pixelArt: null, fullscreen: null, indexCard: null },
        votes: Math.floor(Math.random() * 50),
        suggestions: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Create characters
    SAMPLE_CHARACTERS.forEach((char, index) => {
      assetsToCreate.push({
        userId: userId,
        title: char.name,
        name: char.name,
        description: char.description,
        assetType: 'character',
        type: 'character',
        backstory: char.backstory,
        species: char.species,
        status: index % 2 === 0 ? 'submitted' : 'approved',
        images: { pixelArt: null, fullscreen: null, indexCard: null },
        votes: Math.floor(Math.random() * 100),
        suggestions: [],
        stats: {
          strength: Math.floor(Math.random() * 10) + 5,
          intelligence: Math.floor(Math.random() * 10) + 5,
          agility: Math.floor(Math.random() * 10) + 5,
          faith: Math.floor(Math.random() * 10) + 5,
          tech: Math.floor(Math.random() * 10) + 5
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Create zones
    SAMPLE_ZONES.forEach((zone, index) => {
      assetsToCreate.push({
        userId: userId,
        title: zone.name,
        name: zone.name,
        description: zone.description,
        assetType: 'zone',
        type: 'zone',
        status: 'submitted',
        images: { pixelArt: null, fullscreen: null, indexCard: null },
        votes: Math.floor(Math.random() * 30),
        suggestions: [],
        properties: zone,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Create anomalies
    SAMPLE_ANOMALIES.forEach((anomaly, index) => {
      assetsToCreate.push({
        userId: userId,
        title: anomaly.name,
        name: anomaly.name,
        description: anomaly.description,
        assetType: 'anomaly',
        type: 'anomaly',
        status: index % 2 === 0 ? 'submitted' : 'approved',
        images: { pixelArt: null, fullscreen: null, indexCard: null },
        votes: Math.floor(Math.random() * 40),
        suggestions: [],
        properties: anomaly,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Create orbital bodies
    ORBITAL_BODIES.forEach((orbital, index) => {
      assetsToCreate.push({
        userId: userId,
        title: orbital.name,
        name: orbital.name,
        description: orbital.description,
        assetType: 'orbital',
        type: 'orbital',
        subType: orbital.type,
        status: index % 3 === 0 ? 'submitted' : 'approved',
        images: { pixelArt: null, fullscreen: null, indexCard: null },
        votes: Math.floor(Math.random() * 80),
        suggestions: [],
        position: {
          x: Math.floor(Math.random() * 2000) - 1000,
          y: Math.floor(Math.random() * 2000) - 1000
        },
        properties: orbital,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Insert all assets
    const result = await assetsCollection.insertMany(assetsToCreate);
    console.log(`✓ Created ${result.insertedCount} assets`);

    // Summary
    console.log('\nAssets created by type:');
    console.log(`  Items: ${SAMPLE_ITEMS.length}`);
    console.log(`  Characters: ${SAMPLE_CHARACTERS.length}`);
    console.log(`  Zones: ${SAMPLE_ZONES.length}`);
    console.log(`  Anomalies: ${SAMPLE_ANOMALIES.length}`);
    console.log(`  Orbital Bodies: ${ORBITAL_BODIES.length}`);
    console.log(`  TOTAL: ${assetsToCreate.length}`);

    // Count by status
    const submitted = assetsToCreate.filter(a => a.status === 'submitted').length;
    const approved = assetsToCreate.filter(a => a.status === 'approved').length;
    console.log(`\nBy status:`);
    console.log(`  Submitted: ${submitted}`);
    console.log(`  Approved: ${approved}`);

  } catch (error) {
    console.error('Error creating assets:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDatabase connection closed');
  }
}

createMixedAssets();
