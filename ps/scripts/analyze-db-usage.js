import { getDb } from '../plugins/mongo/mongo.js';

/**
 * Analyzes MongoDB database usage and collection sizes
 * Returns detailed statistics about storage usage
 */
export async function analyzeDatabase() {
  try {
    const db = getDb();
    const adminDb = db.admin();

    // Get database stats
    const dbStats = await db.stats();

    // Get all collections
    const collections = await db.listCollections().toArray();

    // Analyze each collection
    const collectionStats = [];

    for (const collection of collections) {
      try {
        // Use the stats command instead of the helper method
        const stats = await db.command({ collStats: collection.name });

        collectionStats.push({
          name: collection.name,
          count: stats.count || 0,
          size: stats.size || 0, // Data size in bytes
          storageSize: stats.storageSize || 0, // Storage size including overhead
          avgObjSize: stats.avgObjSize || 0,
          indexSize: stats.totalIndexSize || 0,
          totalSize: (stats.storageSize || 0) + (stats.totalIndexSize || 0),
          indexes: stats.nindexes || 0
        });
      } catch (err) {
        console.warn(`Could not get stats for ${collection.name}:`, err.message);
      }
    }

    // Sort by total size (descending)
    collectionStats.sort((a, b) => b.totalSize - a.totalSize);

    // Calculate percentages
    const totalDataSize = collectionStats.reduce((sum, c) => sum + c.size, 0);
    const totalStorageSize = collectionStats.reduce((sum, c) => sum + c.totalSize, 0);

    collectionStats.forEach(c => {
      c.percentOfTotal = totalStorageSize > 0 ?
        ((c.totalSize / totalStorageSize) * 100).toFixed(2) : 0;
    });

    return {
      database: {
        name: db.databaseName,
        collections: collections.length,
        dataSize: dbStats.dataSize || 0,
        storageSize: dbStats.storageSize || 0,
        indexSize: dbStats.indexSize || 0,
        totalSize: (dbStats.storageSize || 0) + (dbStats.indexSize || 0),
        avgObjSize: dbStats.avgObjSize || 0,
        objects: dbStats.objects || 0
      },
      collections: collectionStats,
      topCollections: collectionStats.slice(0, 10), // Top 10 largest
      summary: {
        totalDataSize,
        totalStorageSize,
        largestCollection: collectionStats[0]?.name || 'N/A',
        largestCollectionSize: collectionStats[0]?.totalSize || 0
      }
    };
  } catch (error) {
    console.error('Error analyzing database:', error);
    throw error;
  }
}

/**
 * Format bytes to human readable size
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Run directly if called as script
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      // Import and connect to MongoDB
      const { connectDB } = await import('../plugins/mongo/mongo.js');
      await connectDB();

      console.log('Analyzing database usage...\n');

      const analysis = await analyzeDatabase();

      console.log('='.repeat(80));
      console.log('DATABASE OVERVIEW');
      console.log('='.repeat(80));
      console.log(`Database Name: ${analysis.database.name}`);
      console.log(`Total Collections: ${analysis.database.collections}`);
      console.log(`Total Documents: ${analysis.database.objects.toLocaleString()}`);
      console.log(`Data Size: ${formatBytes(analysis.database.dataSize)}`);
      console.log(`Storage Size: ${formatBytes(analysis.database.storageSize)}`);
      console.log(`Index Size: ${formatBytes(analysis.database.indexSize)}`);
      console.log(`Total Size: ${formatBytes(analysis.database.totalSize)}`);
      console.log(`Average Object Size: ${formatBytes(analysis.database.avgObjSize)}`);
      console.log('');

      console.log('='.repeat(80));
      console.log('TOP 10 LARGEST COLLECTIONS (BY STORAGE + INDEX SIZE)');
      console.log('='.repeat(80));
      console.log(
        'Collection'.padEnd(30) +
        'Documents'.padEnd(15) +
        'Data Size'.padEnd(15) +
        'Storage'.padEnd(15) +
        'Indexes'.padEnd(15) +
        'Total'.padEnd(15) +
        '% of DB'
      );
      console.log('-'.repeat(120));

      analysis.topCollections.forEach(c => {
        console.log(
          c.name.padEnd(30) +
          c.count.toLocaleString().padEnd(15) +
          formatBytes(c.size).padEnd(15) +
          formatBytes(c.storageSize).padEnd(15) +
          formatBytes(c.indexSize).padEnd(15) +
          formatBytes(c.totalSize).padEnd(15) +
          c.percentOfTotal + '%'
        );
      });

      console.log('');
      console.log('='.repeat(80));
      console.log('RECOMMENDATIONS');
      console.log('='.repeat(80));

      // Analyze and provide recommendations
      const recommendations = [];

      analysis.collections.forEach(c => {
        // Check for collections with high index overhead
        if (c.indexSize > c.storageSize && c.storageSize > 0) {
          recommendations.push(
            `⚠️  ${c.name}: Index size (${formatBytes(c.indexSize)}) exceeds storage size - consider reviewing indexes`
          );
        }

        // Check for large collections
        if (c.totalSize > 100 * 1024 * 1024) { // > 100 MB
          recommendations.push(
            `📊 ${c.name}: Large collection (${formatBytes(c.totalSize)}) - consider archiving old data or partitioning`
          );
        }

        // Check for empty collections taking up space
        if (c.count === 0 && c.storageSize > 1024) {
          recommendations.push(
            `🗑️  ${c.name}: Empty collection with ${formatBytes(c.storageSize)} storage - consider dropping`
          );
        }
      });

      if (recommendations.length === 0) {
        console.log('✅ No issues detected - database looks healthy!');
      } else {
        recommendations.forEach(r => console.log(r));
      }

      console.log('');
      process.exit(0);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}
