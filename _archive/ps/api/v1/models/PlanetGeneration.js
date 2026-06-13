/**
 * Planet Generation Model
 * Handles procedural planet generation, chunking, and pioneer tracking
 */
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

export class PlanetGeneration {
  /**
   * Initialize planet generation data when first visited
   */
  static async initializePlanet(planetId, userId) {
    const db = getDb();

    // Check if planet already has generation data
    const existing = await db.collection('planetGeneration').findOne({
      planetId: new ObjectId(planetId)
    });

    if (existing) {
      return existing;
    }

    // Get planet asset data for seed generation
    const planet = await db.collection(collections.assets).findOne({
      _id: new ObjectId(planetId)
    });

    if (!planet) {
      throw new Error('Planet not found');
    }

    // Generate seed from planet properties
    const seed = this.generateSeed(planet);

    const generationData = {
      planetId: new ObjectId(planetId),
      seed: seed,
      pioneerId: new ObjectId(userId),
      pioneerUsername: null, // Will be populated when fetched
      status: 'seeding', // seeding, ready, error
      seedingProgress: 0,
      seedingStartedAt: new Date(),
      seedingCompletedAt: null,

      // Terrain generation parameters
      parameters: {
        size: this.calculatePlanetSize(planet),
        chunkSize: 64, // 64x64 tiles per chunk
        biomes: this.generateBiomes(planet, seed),
        terrainRoughness: this.getTerrainRoughness(planet),
        waterLevel: this.getWaterLevel(planet),
        resourceDensity: this.getResourceDensity(planet),
        temperature: typeof planet.climate === 'object' ? (planet.climate?.temperature || 20) : 20,
        atmosphere: planet.atmosphere || 'breathable'
      },

      // Chunk tracking
      chunks: {
        generated: 0,
        total: 0, // Will be calculated based on size
        registry: [] // Array of {x, y, generatedAt}
      },

      // Statistics
      stats: {
        visitors: 1,
        totalScans: 0,
        resourcesHarvested: 0,
        discoveriesMade: 0
      },

      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Calculate total chunks needed
    const totalChunks = Math.ceil(generationData.parameters.size / generationData.parameters.chunkSize) ** 2;
    generationData.chunks.total = totalChunks;

    await db.collection('planetGeneration').insertOne(generationData);

    // Award pioneer achievement to user
    await this.awardPioneerAchievement(userId, planetId, planet.title);

    return generationData;
  }

  /**
   * Generate deterministic seed from planet properties
   */
  static generateSeed(planet) {
    const coordX = planet.coordinates?.x || 0;
    const coordY = planet.coordinates?.y || 0;
    const coordZ = planet.coordinates?.z || 0;
    const str = `${planet._id.toString()}-${planet.title}-${coordX}-${coordY}-${coordZ}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Calculate planet size (in tiles)
   */
  static calculatePlanetSize(planet) {
    const baseSize = 512; // Small planet
    const sizes = {
      'small': 512,
      'medium': 1024,
      'large': 2048,
      'huge': 4096
    };

    // Use planet stats or default to medium
    const sizeClass = planet.stats?.size || 'medium';
    return sizes[sizeClass] || baseSize;
  }

  /**
   * Generate biome distribution
   */
  static generateBiomes(planet, seed) {
    const climate = planet.climate || {};
    const baseTemp = typeof climate === 'string' ? 20 : (climate.temperature || 20);

    const biomes = [];

    // Temperature-based biome selection
    if (baseTemp < -20) {
      biomes.push({ type: 'frozen', weight: 0.7 });
      biomes.push({ type: 'tundra', weight: 0.2 });
      biomes.push({ type: 'ice_caves', weight: 0.1 });
    } else if (baseTemp < 0) {
      biomes.push({ type: 'tundra', weight: 0.5 });
      biomes.push({ type: 'frozen', weight: 0.3 });
      biomes.push({ type: 'alpine', weight: 0.2 });
    } else if (baseTemp < 15) {
      biomes.push({ type: 'temperate', weight: 0.4 });
      biomes.push({ type: 'forest', weight: 0.3 });
      biomes.push({ type: 'plains', weight: 0.3 });
    } else if (baseTemp < 30) {
      biomes.push({ type: 'grassland', weight: 0.4 });
      biomes.push({ type: 'savanna', weight: 0.3 });
      biomes.push({ type: 'forest', weight: 0.3 });
    } else {
      biomes.push({ type: 'desert', weight: 0.5 });
      biomes.push({ type: 'volcanic', weight: 0.3 });
      biomes.push({ type: 'wasteland', weight: 0.2 });
    }

    return biomes;
  }

  /**
   * Get terrain roughness factor
   */
  static getTerrainRoughness(planet) {
    const gravity = planet.gravity || 1.0;
    // Higher gravity = smoother terrain (erosion)
    // Lower gravity = rougher terrain
    return Math.max(0.1, Math.min(2.0, 1.5 - (gravity * 0.3)));
  }

  /**
   * Get water level (0-1)
   */
  static getWaterLevel(planet) {
    const atmosphere = planet.atmosphere;
    if (!atmosphere || atmosphere === 'none') return 0;
    if (atmosphere === 'toxic') return 0.1;
    if (atmosphere === 'thin') return 0.2;
    return 0.3 + (Math.random() * 0.4); // 0.3 to 0.7
  }

  /**
   * Get resource density
   */
  static getResourceDensity(planet) {
    const resources = planet.resources || [];
    const baseDensity = resources.length * 0.1;
    return Math.min(1.0, baseDensity + (Math.random() * 0.3));
  }

  /**
   * Award pioneer achievement
   */
  static async awardPioneerAchievement(userId, planetId, planetName) {
    const db = getDb();

    await db.collection('achievements').insertOne({
      userId: new ObjectId(userId),
      type: 'pioneer',
      title: 'Pioneer',
      description: `First visitor to ${planetName}`,
      planetId: new ObjectId(planetId),
      planetName: planetName,
      awardedAt: new Date(),
      rarity: 'legendary',
      experience: 1000
    });

    // Update user analytics
    await db.collection('userAnalytics').updateOne(
      { userId: new ObjectId(userId) },
      {
        $inc: { 'achievements.pioneer': 1, totalExperience: 1000 },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );
  }

  /**
   * Generate a specific chunk
   */
  static async generateChunk(planetId, chunkX, chunkY) {
    const db = getDb();

    const planetGen = await db.collection('planetGeneration').findOne({
      planetId: new ObjectId(planetId)
    });

    if (!planetGen) {
      throw new Error('Planet generation data not found');
    }

    // Check if chunk already exists
    const existingChunk = await db.collection('planetChunks').findOne({
      planetId: new ObjectId(planetId),
      chunkX,
      chunkY
    });

    if (existingChunk) {
      return existingChunk;
    }

    // Generate chunk data using procedural generation
    const chunkData = this.procedurallyGenerateChunk(
      planetGen.seed,
      chunkX,
      chunkY,
      planetGen.parameters
    );

    const chunk = {
      planetId: new ObjectId(planetId),
      chunkX,
      chunkY,
      data: chunkData, // Terrain tiles, resources, features
      generatedAt: new Date(),
      modified: false,
      modifiedBy: []
    };

    await db.collection('planetChunks').insertOne(chunk);

    // Update planet generation progress
    await db.collection('planetGeneration').updateOne(
      { planetId: new ObjectId(planetId) },
      {
        $inc: { 'chunks.generated': 1, 'seedingProgress': 1 },
        $push: { 'chunks.registry': { x: chunkX, y: chunkY, generatedAt: new Date() } },
        $set: { updatedAt: new Date() }
      }
    );

    return chunk;
  }

  /**
   * Procedurally generate chunk terrain data
   */
  static procedurallyGenerateChunk(seed, chunkX, chunkY, parameters) {
    const chunkSize = parameters.chunkSize;
    const tiles = [];

    // Simple Perlin-like noise generation (simplified for demo)
    // In production, use a proper noise library
    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const worldX = chunkX * chunkSize + x;
        const worldY = chunkY * chunkSize + y;

        // Generate height using pseudo-random based on position and seed
        const height = this.noise(worldX, worldY, seed) * parameters.terrainRoughness;

        // Select biome based on height and position
        const biome = this.selectBiome(height, parameters.biomes, worldX, worldY, seed);

        // Determine if water
        const isWater = height < parameters.waterLevel;

        // Generate resources based on biome and density
        const resource = this.generateResource(biome, parameters.resourceDensity, worldX, worldY, seed);

        tiles.push({
          x,
          y,
          worldX,
          worldY,
          height,
          biome,
          terrain: isWater ? 'water' : biome.type,
          resource: resource,
          discovered: false
        });
      }
    }

    return {
      tiles,
      features: this.generateChunkFeatures(chunkX, chunkY, seed, parameters)
    };
  }

  /**
   * Simple noise function (pseudo-random)
   */
  static noise(x, y, seed) {
    const n = x + y * 57 + seed * 131;
    const val = (n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff;
    return (val / 0x7fffffff);
  }

  /**
   * Select biome based on height and position
   */
  static selectBiome(height, biomes, x, y, seed) {
    // Use height and position to vary biome
    const biomeNoise = this.noise(Math.floor(x / 32), Math.floor(y / 32), seed + 1000);

    let cumulative = 0;
    for (const biome of biomes) {
      cumulative += biome.weight;
      if (biomeNoise < cumulative) {
        return biome;
      }
    }

    return biomes[0];
  }

  /**
   * Generate resource for tile
   */
  static generateResource(biome, density, x, y, seed) {
    const resourceNoise = this.noise(x, y, seed + 5000);

    if (resourceNoise > (1 - density * 0.2)) {
      const resources = {
        'frozen': ['ice', 'rare_minerals'],
        'tundra': ['minerals', 'fossils'],
        'desert': ['minerals', 'crystals'],
        'volcanic': ['obsidian', 'rare_metals'],
        'forest': ['wood', 'plants'],
        'grassland': ['plants', 'water'],
        'default': ['minerals']
      };

      const biomeResources = resources[biome.type] || resources.default;
      const resourceIndex = Math.floor(resourceNoise * biomeResources.length * 10) % biomeResources.length;

      return {
        type: biomeResources[resourceIndex],
        quantity: Math.floor(resourceNoise * 10) + 1
      };
    }

    return null;
  }

  /**
   * Generate special features for chunk (caves, structures, etc.)
   */
  static generateChunkFeatures(chunkX, chunkY, seed, parameters) {
    const features = [];
    const featureNoise = this.noise(chunkX * 100, chunkY * 100, seed + 10000);

    // Rare chance for special features
    if (featureNoise > 0.95) {
      features.push({
        type: 'cave_entrance',
        x: Math.floor(Math.random() * parameters.chunkSize),
        y: Math.floor(Math.random() * parameters.chunkSize)
      });
    } else if (featureNoise > 0.90) {
      features.push({
        type: 'ancient_ruins',
        x: Math.floor(Math.random() * parameters.chunkSize),
        y: Math.floor(Math.random() * parameters.chunkSize)
      });
    }

    return features;
  }

  /**
   * Generate a batch of chunks efficiently (for seeding)
   */
  static async generateBatchChunks(planetId, batchSize = 25) {
    const db = getDb();

    // Get planet generation data
    const planetGen = await db.collection('planetGeneration').findOne({
      planetId: new ObjectId(planetId)
    });

    if (!planetGen) {
      throw new Error('Planet generation data not found');
    }

    // Get already generated chunk coordinates
    const existingChunks = await db.collection('planetChunks')
      .find({ planetId: new ObjectId(planetId) })
      .project({ chunkX: 1, chunkY: 1 })
      .toArray();

    const existingSet = new Set(
      existingChunks.map(c => `${c.chunkX},${c.chunkY}`)
    );

    const generatedChunks = [];
    let currentRadius = 0;
    let generated = 0;

    // Generate chunks in spiral pattern, skipping existing ones
    while (generated < batchSize && currentRadius < 100) {
      for (let y = -currentRadius; y <= currentRadius && generated < batchSize; y++) {
        for (let x = -currentRadius; x <= currentRadius && generated < batchSize; x++) {
          // Only generate if on the edge of current radius (spiral)
          if (Math.abs(x) === currentRadius || Math.abs(y) === currentRadius) {
            const key = `${x},${y}`;

            // Skip if already generated
            if (!existingSet.has(key)) {
              try {
                await this.generateChunk(planetId, x, y);
                generatedChunks.push({ x, y });
                generated++;
                existingSet.add(key); // Mark as generated to avoid duplicates in this batch
              } catch (error) {
                console.error(`Error generating chunk ${x},${y}:`, error);
              }
            }
          }
        }
      }
      currentRadius++;
    }

    return generatedChunks;
  }

  /**
   * Get chunks in radius around position
   */
  static async getChunksAround(planetId, centerChunkX, centerChunkY, radius = 2) {
    const db = getDb();
    const chunks = [];

    for (let y = centerChunkY - radius; y <= centerChunkY + radius; y++) {
      for (let x = centerChunkX - radius; x <= centerChunkX + radius; x++) {
        let chunk = await db.collection('planetChunks').findOne({
          planetId: new ObjectId(planetId),
          chunkX: x,
          chunkY: y
        });

        // Generate chunk if it doesn't exist
        if (!chunk) {
          chunk = await this.generateChunk(planetId, x, y);
        }

        chunks.push(chunk);
      }
    }

    return chunks;
  }

  /**
   * Get planet generation status
   */
  static async getStatus(planetId) {
    const db = getDb();

    const planetGen = await db.collection('planetGeneration').findOne({
      planetId: new ObjectId(planetId)
    });

    if (!planetGen) {
      return { status: 'not_initialized' };
    }

    // Get pioneer username
    if (planetGen.pioneerId && !planetGen.pioneerUsername) {
      const pioneer = await db.collection(collections.users).findOne({
        _id: planetGen.pioneerId
      });
      planetGen.pioneerUsername = pioneer?.username || 'Unknown Pioneer';
    }

    return {
      status: planetGen.status,
      progress: planetGen.seedingProgress,
      total: planetGen.chunks.total,
      percentage: planetGen.chunks.total > 0
        ? Math.round((planetGen.seedingProgress / planetGen.chunks.total) * 100)
        : 0,
      pioneer: {
        id: planetGen.pioneerId,
        username: planetGen.pioneerUsername
      },
      parameters: planetGen.parameters,
      stats: planetGen.stats
    };
  }

  /**
   * Mark planet as ready (seeding complete)
   */
  static async markReady(planetId) {
    const db = getDb();

    await db.collection('planetGeneration').updateOne(
      { planetId: new ObjectId(planetId) },
      {
        $set: {
          status: 'ready',
          seedingCompletedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Record visitor
   */
  static async recordVisitor(planetId, userId) {
    const db = getDb();

    await db.collection('planetGeneration').updateOne(
      { planetId: new ObjectId(planetId) },
      {
        $inc: { 'stats.visitors': 1 },
        $set: { updatedAt: new Date() }
      }
    );
  }
}

export default PlanetGeneration;
