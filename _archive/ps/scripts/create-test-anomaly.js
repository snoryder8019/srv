/**
 * Create Test Anomaly Asset
 * Quick script to create a test anomaly for hierarchy testing
 */

import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function createTestAnomaly() {
  try {
    await connectDB();
    const db = getDb();

    // Check if anomalies exist
    const existingAnomalies = await db.collection('assets').countDocuments({ assetType: 'anomaly' });
    console.log(`Found ${existingAnomalies} existing anomaly assets`);

    if (existingAnomalies === 0) {
      console.log('Creating test anomaly asset...');

      const anomaly = {
        userId: new ObjectId(), // Placeholder user ID
        name: 'Test Cosmic Anomaly',
        title: 'Test Cosmic Anomaly',
        description: 'A test anomaly for hierarchy testing',
        assetType: 'anomaly',
        published: true,
        images: {
          fullscreen: '/images/placeholder-anomaly.png',
          indexCard: '/images/placeholder-anomaly-thumb.png'
        },
        hierarchy: {
          parent: null,
          parentType: null,
          children: [],
          depth: 0,
          path: []
        },
        tags: ['test', 'anomaly'],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('assets').insertOne(anomaly);
      console.log('Test anomaly created:', result.insertedId);

      // Create a second one for variety
      const anomaly2 = {
        ...anomaly,
        _id: undefined,
        name: 'Dimensional Rift',
        title: 'Dimensional Rift',
        description: 'A second test anomaly'
      };

      const result2 = await db.collection('assets').insertOne(anomaly2);
      console.log('Second test anomaly created:', result2.insertedId);
    } else {
      console.log('Anomalies already exist, skipping creation');
    }

    // List all anomalies
    const anomalies = await db.collection('assets')
      .find({ assetType: 'anomaly' })
      .project({ _id: 1, name: 1, title: 1 })
      .toArray();

    console.log('\nAll anomaly assets:');
    anomalies.forEach(a => {
      console.log(`  - ${a.title || a.name} (${a._id})`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createTestAnomaly();
