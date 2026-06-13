/**
 * Scan Universe Assets for Storyline Mapping
 * Analyzes existing galaxies, stars, and planets to suggest lore connections
 */

import { config } from 'dotenv';
config();

import { MongoClient } from 'mongodb';

const DB_URL = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME || 'projectStringborne';

// Storyline themes and keywords
const STORYLINE_KEYWORDS = {
  'arc_01_deepcore': {
    arc: 'Deepcore Descent',
    keywords: ['mining', 'colony', 'underground', 'tunnel', 'industrial', 'labor', 'deepcore', 'excavation'],
    suggestedNames: ['Deepcore Mining Colony', 'Tunnel Station Alpha', 'Industrial Outpost']
  },
  'arc_02_lost_in_space': {
    arc: 'Lost in Space',
    keywords: ['void', 'edge', 'derelict', 'drift', 'silent', 'isolated', 'abandoned', 'anomaly'],
    suggestedNames: ["Void's Edge", 'Drift Station', 'Silent Outpost', 'Derelict Habitat']
  },
  'arc_03_mogul': {
    arc: "The Mogul's Ascent",
    keywords: ['corporate', 'tower', 'luxury', 'penthouse', 'club', 'night', 'neon', 'biotech'],
    suggestedNames: ['Corporate Nexus', 'Luxury Station', 'Nightclub Orbital', 'Biotech Hub']
  },
  'arc_04_astral': {
    arc: 'Astral Enigma',
    keywords: ['astral', 'metaphysical', 'enigma', 'paradox', 'singularity', 'nexus', 'primordial'],
    suggestedNames: ['The Nexus Singularity', 'Paradox Point', 'Astral Construct']
  }
};

async function main() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get all universe assets
    const anomalies = await assetsCollection.find({ assetType: 'anomaly' }).toArray();
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    const stars = await assetsCollection.find({ assetType: 'star' }).toArray();
    const planets = await assetsCollection.find({ assetType: 'planet' }).toArray();
    const stations = await assetsCollection.find({ assetType: 'orbital' }).toArray();

    console.log('=== UNIVERSE ASSET INVENTORY ===');
    console.log(`Anomalies: ${anomalies.length}`);
    console.log(`Galaxies: ${galaxies.length}`);
    console.log(`Stars: ${stars.length}`);
    console.log(`Planets: ${planets.length}`);
    console.log(`Stations: ${stations.length}\n`);

    // Analyze and suggest mappings
    const suggestions = [];

    console.log('=== STORYLINE MAPPING SUGGESTIONS ===\n');

    // Check Anomalies
    console.log('🔮 ANOMALIES:');
    for (const anomaly of anomalies) {
      const suggestion = analyzAsset(anomaly);
      if (suggestion) {
        suggestions.push(suggestion);
        console.log(`  ${anomaly.title}`);
        console.log(`    → Suggested Arc: ${suggestion.arc}`);
        console.log(`    → Confidence: ${suggestion.confidence}`);
        console.log(`    → Reason: ${suggestion.reason}\n`);
      } else {
        console.log(`  ${anomaly.title} - No strong lore match found\n`);
      }
    }

    // Check Galaxies
    console.log('\n🌌 GALAXIES:');
    for (const galaxy of galaxies) {
      const suggestion = analyzeAsset(galaxy);
      if (suggestion) {
        suggestions.push(suggestion);
        console.log(`  ${galaxy.title}`);
        console.log(`    → Suggested Arc: ${suggestion.arc}`);
        console.log(`    → Confidence: ${suggestion.confidence}`);
        console.log(`    → Reason: ${suggestion.reason}\n`);
      } else {
        console.log(`  ${galaxy.title} - No strong lore match found\n`);
      }
    }

    // Check Stars
    console.log('\n⭐ STARS:');
    for (const star of stars) {
      const suggestion = analyzeAsset(star);
      if (suggestion) {
        suggestions.push(suggestion);
        console.log(`  ${star.title}`);
        console.log(`    → Suggested Arc: ${suggestion.arc}`);
        console.log(`    → Confidence: ${suggestion.confidence}`);
        console.log(`    → Reason: ${suggestion.reason}\n`);
      }
    }

    // Check Planets
    console.log('\n🌍 PLANETS (showing matches only):');
    let planetMatches = 0;
    for (const planet of planets) {
      const suggestion = analyzeAsset(planet);
      if (suggestion) {
        suggestions.push(suggestion);
        planetMatches++;
        console.log(`  ${planet.title}`);
        console.log(`    → Suggested Arc: ${suggestion.arc}`);
        console.log(`    → Confidence: ${suggestion.confidence}`);
        console.log(`    → Reason: ${suggestion.reason}\n`);
      }
    }
    console.log(`  (${planetMatches} of ${planets.length} planets matched)\n`);

    // Check Stations
    console.log('\n🛰️ STATIONS:');
    for (const station of stations) {
      const suggestion = analyzeAsset(station);
      if (suggestion) {
        suggestions.push(suggestion);
        console.log(`  ${station.title}`);
        console.log(`    → Suggested Arc: ${suggestion.arc}`);
        console.log(`    → Confidence: ${suggestion.confidence}`);
        console.log(`    → Reason: ${suggestion.reason}\n`);
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total suggestions: ${suggestions.length}`);
    console.log('\nHigh confidence matches (STRONG LORE FIT):');
    suggestions.filter(s => s.confidence === 'HIGH').forEach(s => {
      console.log(`  • ${s.asset.title} → ${s.arc}`);
    });

    console.log('\nMedium confidence matches:');
    suggestions.filter(s => s.confidence === 'MEDIUM').forEach(s => {
      console.log(`  • ${s.asset.title} → ${s.arc}`);
    });

    console.log('\n=== RECOMMENDED ACTIONS ===');
    console.log('1. Review high-confidence matches above');
    console.log('2. Consider renaming generic assets to match storyline themes');
    console.log('3. Run update script to add storyline metadata to assets');
    console.log('4. Link storyline assets to these universe locations\n');

  } catch (error) {
    console.error('❌ Error scanning universe:', error);
    throw error;
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

/**
 * Analyze an asset for storyline connections
 */
function analyzeAsset(asset) {
  const titleLower = asset.title.toLowerCase();
  const descLower = (asset.description || '').toLowerCase();
  const combined = `${titleLower} ${descLower}`;

  for (const [arcId, arcData] of Object.entries(STORYLINE_KEYWORDS)) {
    for (const keyword of arcData.keywords) {
      if (combined.includes(keyword)) {
        // Determine confidence based on keyword match location
        let confidence = 'LOW';
        if (titleLower.includes(keyword)) {
          confidence = 'HIGH';
        } else if (descLower.includes(keyword)) {
          confidence = 'MEDIUM';
        }

        return {
          asset: {
            id: asset._id.toString(),
            title: asset.title,
            type: asset.assetType
          },
          arc: arcData.arc,
          arcId: arcId,
          confidence: confidence,
          reason: `Contains keyword "${keyword}" in ${titleLower.includes(keyword) ? 'title' : 'description'}`
        };
      }
    }
  }

  return null;
}

main().catch(console.error);
