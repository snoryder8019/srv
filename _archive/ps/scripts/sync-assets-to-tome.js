/**
 * Sync All Assets to Tome Archive
 *
 * This script updates the Tome archive with all approved assets from the database,
 * categorizing them properly and ensuring all asset types are represented in the
 * universal archive.
 *
 * Usage: node scripts/sync-assets-to-tome.js
 */

import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

const MONGO_URI = process.env.DB_URL || process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'projectStringborne';

async function syncAssetsToTome() {
  const client = new MongoClient(MONGO_URI);

  try {
    console.log('🔗 Connecting to MongoDB...');
    await client.connect();
    const db = client.db(DB_NAME);
    console.log('✅ Connected to database:', DB_NAME);

    // Fetch all approved assets
    console.log('\n📊 Fetching all approved assets...');
    const assets = await db.collection('assets')
      .find({ status: 'approved' })
      .toArray();

    console.log(`✅ Found ${assets.length} approved assets`);

    // Categorize assets
    const categories = {
      galaxies: [],
      stars: [],
      planets: [],
      orbitals: [],
      anomalies: [],
      characters: [],
      species: [],
      items: [],
      weapons: [],
      environments: [],
      objects: [],
      other: []
    };

    // Organize assets by type
    assets.forEach(asset => {
      switch (asset.assetType) {
        case 'galaxy':
          categories.galaxies.push(asset);
          break;
        case 'star':
          categories.stars.push(asset);
          break;
        case 'planet':
          categories.planets.push(asset);
          break;
        case 'orbital':
          categories.orbitals.push(asset);
          break;
        case 'anomaly':
          categories.anomalies.push(asset);
          break;
        case 'character':
          categories.characters.push(asset);
          break;
        case 'species':
          categories.species.push(asset);
          break;
        case 'item':
          categories.items.push(asset);
          break;
        case 'weapon':
          categories.weapons.push(asset);
          break;
        case 'environment':
          categories.environments.push(asset);
          break;
        case 'object':
          categories.objects.push(asset);
          break;
        default:
          categories.other.push(asset);
      }
    });

    // Display categorization results
    console.log('\n📋 Asset Categorization:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🌌 Galaxies:      ${categories.galaxies.length.toString().padStart(4)}`);
    console.log(`⭐ Stars:         ${categories.stars.length.toString().padStart(4)}`);
    console.log(`🪐 Planets:       ${categories.planets.length.toString().padStart(4)}`);
    console.log(`🛰️  Orbitals:      ${categories.orbitals.length.toString().padStart(4)}`);
    console.log(`✨ Anomalies:     ${categories.anomalies.length.toString().padStart(4)}`);
    console.log(`👤 Characters:    ${categories.characters.length.toString().padStart(4)}`);
    console.log(`👽 Species:       ${categories.species.length.toString().padStart(4)}`);
    console.log(`📦 Items:         ${categories.items.length.toString().padStart(4)}`);
    console.log(`⚔️  Weapons:       ${categories.weapons.length.toString().padStart(4)}`);
    console.log(`🏞️  Environments:  ${categories.environments.length.toString().padStart(4)}`);
    console.log(`🔧 Objects:       ${categories.objects.length.toString().padStart(4)}`);
    console.log(`❓ Other:         ${categories.other.length.toString().padStart(4)}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Total:         ${assets.length.toString().padStart(4)}`);

    // Check if tome_archive collection exists or create it
    console.log('\n📚 Syncing to Tome Archive...');

    const tomeExists = await db.listCollections({ name: 'tome_archive' }).hasNext();
    if (!tomeExists) {
      console.log('📖 Creating new tome_archive collection...');
      await db.createCollection('tome_archive');
    }

    // Clear existing tome archive (full refresh)
    const deleteResult = await db.collection('tome_archive').deleteMany({});
    console.log(`🗑️  Cleared ${deleteResult.deletedCount} old archive entries`);

    // Create tome archive entries
    const tomeEntries = [];
    const timestamp = new Date();

    for (const [category, items] of Object.entries(categories)) {
      if (items.length > 0) {
        tomeEntries.push({
          category: category,
          categoryName: getCategoryDisplayName(category),
          assetCount: items.length,
          assets: items.map(asset => ({
            _id: asset._id,
            title: asset.title,
            description: asset.description,
            assetType: asset.assetType,
            subType: asset.subType,
            images: asset.images,
            lore: asset.lore,
            backstory: asset.backstory,
            flavor: asset.flavor,
            stats: asset.stats,
            effects: asset.effects,
            rarity: asset.rarity,
            tags: asset.tags,
            votes: asset.votes,
            userId: asset.userId,
            parentGalaxy: asset.parentGalaxy,
            parentStar: asset.parentStar,
            coordinates: asset.coordinates,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt
          })),
          lastUpdated: timestamp,
          syncedAt: timestamp
        });
      }
    }

    if (tomeEntries.length > 0) {
      const insertResult = await db.collection('tome_archive').insertMany(tomeEntries);
      console.log(`✅ Created ${insertResult.insertedCount} tome archive categories`);
    }

    // Create summary document
    const summary = {
      type: 'tome_summary',
      totalAssets: assets.length,
      totalCategories: tomeEntries.length,
      breakdown: Object.entries(categories).reduce((acc, [key, items]) => {
        acc[key] = items.length;
        return acc;
      }, {}),
      lastSyncedAt: timestamp,
      syncedBy: 'admin-script'
    };

    await db.collection('tome_archive').insertOne(summary);
    console.log('✅ Created tome summary document');

    // Display top creators
    console.log('\n👥 Top Asset Creators:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const creatorStats = {};
    assets.forEach(asset => {
      const userId = asset.userId?.toString();
      if (userId) {
        if (!creatorStats[userId]) {
          creatorStats[userId] = { count: 0, votes: 0 };
        }
        creatorStats[userId].count++;
        creatorStats[userId].votes += (asset.votes || 0);
      }
    });

    const sortedCreators = Object.entries(creatorStats)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    for (const [userId, stats] of sortedCreators) {
      try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        const username = user?.username || 'Unknown';
        console.log(`   @${username.padEnd(20)} ${stats.count.toString().padStart(3)} assets, ${stats.votes.toString().padStart(4)} votes`);
      } catch (err) {
        console.log(`   Unknown User           ${stats.count.toString().padStart(3)} assets, ${stats.votes.toString().padStart(4)} votes`);
      }
    }

    // Display recent additions
    console.log('\n🆕 Recent Approved Assets (Last 5):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const recentAssets = assets
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 5);

    for (const asset of recentAssets) {
      const typeIcon = getAssetTypeIcon(asset.assetType);
      console.log(`   ${typeIcon} ${asset.title} (${asset.assetType})`);
    }

    console.log('\n✨ Tome Archive Sync Complete!');
    console.log(`📖 View the Tome at: /universe/tome`);
    console.log(`📊 ${assets.length} assets now cataloged in the universal archive\n`);

  } catch (error) {
    console.error('❌ Error syncing assets to tome:', error);
    throw error;
  } finally {
    await client.close();
    console.log('🔒 Database connection closed');
  }
}

/**
 * Get display name for category
 */
function getCategoryDisplayName(category) {
  const names = {
    galaxies: 'Galaxies',
    stars: 'Stars',
    planets: 'Planets',
    orbitals: 'Orbital Stations',
    anomalies: 'Anomalies & Phenomena',
    characters: 'Notable Characters',
    species: 'Species',
    items: 'Items',
    weapons: 'Weapons',
    environments: 'Environments',
    objects: 'Objects',
    other: 'Other'
  };
  return names[category] || category;
}

/**
 * Get icon for asset type
 */
function getAssetTypeIcon(assetType) {
  const icons = {
    galaxy: '🌌',
    star: '⭐',
    planet: '🪐',
    orbital: '🛰️',
    anomaly: '✨',
    character: '👤',
    species: '👽',
    item: '📦',
    weapon: '⚔️',
    environment: '🏞️',
    object: '🔧'
  };
  return icons[assetType] || '❓';
}

// Run the script
syncAssetsToTome()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
