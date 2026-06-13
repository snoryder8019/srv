/**
 * Create zone entries for orbital bodies and attach planetary assets
 */
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

// Orbital bodies we created
const ORBITALS = [
  { name: 'Trading Post Sigma', position: { x: 800, y: 1000 } },
  { name: 'Forge Outpost Delta', position: { x: 4200, y: 800 } },
  { name: 'Sanctuary Station', position: { x: 700, y: 4200 } },
  { name: 'Battle Station Omega', position: { x: 4300, y: 4200 } },
  { name: 'Waypoint Nexus', position: { x: 2500, y: 1800 } },
  { name: 'Mining Platform Beta', position: { x: 1800, y: 3200 } },
  { name: 'Research Habitat Zeta', position: { x: 3200, y: 2800 } }
];

// Planet types and their characteristics
const PLANET_TYPES = {
  terrestrial: {
    atmospheres: ['Oxygen-rich', 'Nitrogen-dominant', 'Thin atmosphere', 'Dense CO2'],
    climates: ['Temperate', 'Arid', 'Frozen', 'Tropical'],
    colors: ['#4a9eff', '#d4a574', '#a8d8ff', '#6ac66a']
  },
  gas_giant: {
    atmospheres: ['Hydrogen-helium mix', 'Methane storms', 'Ammonia clouds'],
    climates: ['Violent storms', 'Calm bands', 'Turbulent'],
    colors: ['#ff9a4a', '#9a4aff', '#4affff']
  },
  ice_world: {
    atmospheres: ['Frozen nitrogen', 'Trace oxygen', 'Methane ice'],
    climates: ['Frozen tundra', 'Glacial', 'Sub-zero'],
    colors: ['#a8d8ff', '#d8e8ff', '#88c8ff']
  },
  volcanic: {
    atmospheres: ['Sulfur dioxide', 'Toxic fumes', 'Ash-laden'],
    climates: ['Volcanic', 'Scorching', 'Molten surface'],
    colors: ['#ff4a4a', '#ff9a00', '#d44a00']
  },
  ocean_world: {
    atmospheres: ['Humid oxygen', 'Water vapor rich', 'Oxygen-nitrogen'],
    climates: ['Ocean coverage', 'Archipelago', 'Deep seas'],
    colors: ['#4a9aff', '#4affff', '#00aaff']
  }
};

function generatePlanetData(orbitalName, planetIndex) {
  const types = Object.keys(PLANET_TYPES);
  const planetType = types[Math.floor(Math.random() * types.length)];
  const typeData = PLANET_TYPES[planetType];

  const planetNames = {
    'Trading Post Sigma': ['Mercatus Prime', 'Argent Moon', 'Commerce Isle'],
    'Forge Outpost Delta': ['Anvil World', 'Crucible Beta', 'Forge Prime'],
    'Sanctuary Station': ['Haven Alpha', 'Serenity', 'Peace Rock'],
    'Battle Station Omega': ['Warforge', 'Bastion Prime', 'Battleground Zeta'],
    'Waypoint Nexus': ['Crossroads', 'Nexus Prime', 'Junction World'],
    'Mining Platform Beta': ['Ore World', 'Mineral Ridge', 'Crystal Depths'],
    'Research Habitat Zeta': ['Lab World', 'Discovery Prime', 'Research Alpha']
  };

  const names = planetNames[orbitalName] || ['Alpha', 'Beta', 'Gamma'];
  const planetName = names[planetIndex] || `${orbitalName} ${planetIndex + 1}`;

  return {
    name: planetName,
    type: planetType,
    atmosphere: typeData.atmospheres[Math.floor(Math.random() * typeData.atmospheres.length)],
    climate: typeData.climates[Math.floor(Math.random() * typeData.climates.length)],
    color: typeData.colors[Math.floor(Math.random() * typeData.colors.length)],
    temperature: planetType === 'ice_world' ? -100 + Math.random() * 50 :
                 planetType === 'volcanic' ? 200 + Math.random() * 400 :
                 planetType === 'gas_giant' ? -150 + Math.random() * 100 :
                 -20 + Math.random() * 80,
    gravity: 0.3 + Math.random() * 2.0,
    size: planetType === 'gas_giant' ? 50000 + Math.random() * 100000 :
          10000 + Math.random() * 30000
  };
}

function generateResources(planetType) {
  const resourcesByType = {
    terrestrial: [
      { name: 'Iron Ore', rarity: 'common', yield: 'high' },
      { name: 'Copper Deposits', rarity: 'common', yield: 'medium' },
      { name: 'Rare Earth Elements', rarity: 'uncommon', yield: 'low' }
    ],
    gas_giant: [
      { name: 'Helium-3', rarity: 'uncommon', yield: 'high' },
      { name: 'Hydrogen Fuel', rarity: 'common', yield: 'very high' },
      { name: 'Exotic Gases', rarity: 'rare', yield: 'low' }
    ],
    ice_world: [
      { name: 'Water Ice', rarity: 'common', yield: 'very high' },
      { name: 'Frozen Methane', rarity: 'common', yield: 'high' },
      { name: 'Crystalline Structures', rarity: 'rare', yield: 'low' }
    ],
    volcanic: [
      { name: 'Geothermal Energy', rarity: 'common', yield: 'high' },
      { name: 'Sulfur Compounds', rarity: 'common', yield: 'high' },
      { name: 'Rare Minerals', rarity: 'uncommon', yield: 'medium' }
    ],
    ocean_world: [
      { name: 'Aquatic Biomass', rarity: 'common', yield: 'high' },
      { name: 'Dissolved Minerals', rarity: 'uncommon', yield: 'medium' },
      { name: 'Exotic Marine Life', rarity: 'rare', yield: 'low' }
    ]
  };

  return resourcesByType[planetType] || [];
}

async function createZonesAndPlanets() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const zonesCollection = db.collection('zones');
    const assetsCollection = db.collection('assets');

    let totalZones = 0;
    let totalPlanets = 0;

    for (const orbital of ORBITALS) {
      console.log(`\n=== ${orbital.name} ===`);

      // Find the orbital asset
      const orbitalAsset = await assetsCollection.findOne({
        title: orbital.name,
        assetType: 'orbital'
      });

      if (!orbitalAsset) {
        console.log(`  ✗ Orbital asset not found, skipping...`);
        continue;
      }

      console.log(`  ✓ Found orbital asset: ${orbitalAsset._id}`);

      // Create 2-3 planets for this orbital
      const numPlanets = 2 + Math.floor(Math.random() * 2); // 2 or 3 planets

      for (let i = 0; i < numPlanets; i++) {
        const planetData = generatePlanetData(orbital.name, i);
        const resources = generateResources(planetData.type);

        // Create zone entry for the planet
        const zoneName = planetData.name.toLowerCase().replace(/\s+/g, '-');

        const zone = {
          zoneName: zoneName,
          displayName: planetData.name,
          type: 'planetary',
          subType: planetData.type,
          description: `A ${planetData.type.replace('_', ' ')} orbiting ${orbital.name}. ${planetData.atmosphere} atmosphere with ${planetData.climate.toLowerCase()} conditions.`,

          // Link to orbital
          orbitalBodyId: orbitalAsset._id.toString(),
          orbitalBodyName: orbital.name,

          // Location (inherit from orbital)
          coordinates: {
            x: orbital.position.x,
            y: orbital.position.y,
            z: 0,
            orbitRadius: 100 + (i * 50) // Different orbit distances
          },

          // Environment
          environment: {
            atmosphere: planetData.atmosphere,
            temperature: Math.round(planetData.temperature),
            humidity: planetData.type === 'ocean_world' ? 80 + Math.random() * 20 : Math.random() * 100,
            gravity: planetData.gravity.toFixed(2) + 'g',
            climate: planetData.climate
          },

          // Resources
          resources: resources,

          // Safety and difficulty
          safetyLevel: planetData.type === 'volcanic' ? 'Dangerous' :
                       planetData.type === 'ice_world' ? 'Hazardous' :
                       planetData.type === 'gas_giant' ? 'Extreme' :
                       'Moderate',
          difficulty: planetData.type === 'gas_giant' || planetData.type === 'volcanic' ? 'Hard' :
                      planetData.type === 'ice_world' ? 'Medium' :
                      'Easy',
          status: 'explorable',

          // Tags
          tags: [
            planetData.type,
            'orbital-zone',
            orbital.name.toLowerCase().replace(/\s+/g, '-'),
            resources.length > 0 ? 'resource-rich' : 'resource-poor'
          ],

          // Visual
          color: planetData.color,
          size: planetData.size,

          // Metadata
          createdAt: new Date(),
          updatedAt: new Date(),
          discoveredBy: null,
          visitCount: 0
        };

        // Insert zone
        const zoneResult = await zonesCollection.insertOne(zone);
        console.log(`  ✓ Created zone: ${planetData.name} (${planetData.type})`);
        totalZones++;

        // Create planetary asset linked to this zone
        const planetAsset = {
          userId: 'system',
          title: planetData.name,
          description: `${planetData.type.replace('_', ' ')} planet in the ${orbital.name} system`,
          assetType: 'planet',
          subType: planetData.type,
          status: 'approved',

          images: {
            pixelArt: null,
            fullscreen: null,
            indexCard: null
          },

          lore: `${planetData.name} circles ${orbital.name}, a world of ${planetData.climate.toLowerCase()} conditions and ${planetData.atmosphere.toLowerCase()}.`,
          backstory: zone.description,
          flavor: `"${planetData.name} - where ${resources[0]?.name || 'secrets'} await the bold."`,

          stats: {
            size: Math.round(planetData.size),
            mass: Math.round(planetData.size * planetData.gravity),
            gravity: planetData.gravity.toFixed(2),
            temperature: Math.round(planetData.temperature),
            atmosphere: planetData.atmosphere,
            resources: resources.length
          },

          // Link to zone and orbital
          zoneId: zoneResult.insertedId.toString(),
          zoneName: zoneName,
          orbitalId: orbitalAsset._id.toString(),
          orbitalName: orbital.name,

          // Position (orbit around orbital)
          orbitData: {
            parentId: orbitalAsset._id.toString(),
            orbitRadius: zone.coordinates.orbitRadius,
            orbitSpeed: 0.001 + Math.random() * 0.005,
            orbitAngle: Math.random() * Math.PI * 2
          },

          tags: [planetData.type, 'planet', 'orbital-body', orbital.name.toLowerCase()],
          category: 'celestial',

          votes: 0,
          voters: [],

          adminNotes: `Auto-created planet for ${orbital.name}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          approvedAt: new Date(),
          approvedBy: 'system'
        };

        await assetsCollection.insertOne(planetAsset);
        console.log(`    └─ Created planet asset: ${planetData.name}`);
        totalPlanets++;
      }
    }

    console.log(`\n✓ Created ${totalZones} zones and ${totalPlanets} planetary assets!`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

createZonesAndPlanets();
