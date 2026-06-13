/**
 * Memory and Resource Usage Tests
 * Tests memory consumption and resource efficiency
 */

import { describe, expect } from '../utils/test-helpers.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Memory thresholds (in MB)
const THRESHOLDS = {
  MEMORY_LEAK_TOLERANCE: 50,  // Max acceptable memory increase in MB
  BASELINE_MEMORY: 100        // Expected baseline memory usage in MB
};

function getMemoryUsageMB() {
  const usage = process.memoryUsage();
  return {
    rss: (usage.rss / 1024 / 1024).toFixed(2),
    heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(2),
    external: (usage.external / 1024 / 1024).toFixed(2)
  };
}

await describe('Memory and Resource Usage', runner => {
  runner.it('should measure baseline memory usage', async () => {
    const initialMemory = getMemoryUsageMB();

    console.log('    Initial memory usage:');
    console.log(`      RSS: ${initialMemory.rss} MB`);
    console.log(`      Heap Used: ${initialMemory.heapUsed} MB`);
    console.log(`      Heap Total: ${initialMemory.heapTotal} MB`);
    console.log(`      External: ${initialMemory.external} MB`);

    // Baseline check - should have reasonable memory usage
    expect(parseFloat(initialMemory.heapUsed)).toBeLessThan(500);
  });

  runner.it('should not leak memory during database operations', async () => {
    const { connectDB, getDb } = await import('../../plugins/mongo/mongo.js');
    await connectDB();
    const db = getDb();

    const initialMemory = parseFloat(getMemoryUsageMB().heapUsed);

    // Perform multiple database operations
    for (let i = 0; i < 100; i++) {
      await db.collection('users').find({}).limit(10).toArray();
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const finalMemory = parseFloat(getMemoryUsageMB().heapUsed);
    const memoryIncrease = finalMemory - initialMemory;

    console.log(`    Memory before: ${initialMemory.toFixed(2)} MB`);
    console.log(`    Memory after: ${finalMemory.toFixed(2)} MB`);
    console.log(`    Memory increase: ${memoryIncrease.toFixed(2)} MB`);

    // Memory increase should be minimal
    expect(memoryIncrease).toBeLessThan(THRESHOLDS.MEMORY_LEAK_TOLERANCE);
  });

  runner.it('should handle large query results efficiently', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const initialMemory = parseFloat(getMemoryUsageMB().heapUsed);

    // Fetch a larger dataset
    const assets = await db.collection('assets').find({}).limit(1000).toArray();

    const afterQueryMemory = parseFloat(getMemoryUsageMB().heapUsed);
    const memoryForData = afterQueryMemory - initialMemory;

    console.log(`    Query returned ${assets.length} documents`);
    console.log(`    Memory used: ${memoryForData.toFixed(2)} MB`);

    // Clear the data
    assets.length = 0;

    // Check memory is reasonable
    expect(memoryForData).toBeLessThan(100);
  });

  runner.it('should measure event loop lag', async () => {
    const measurements = [];
    const numMeasurements = 10;

    for (let i = 0; i < numMeasurements; i++) {
      const start = Date.now();
      await new Promise(resolve => setImmediate(resolve));
      const lag = Date.now() - start;
      measurements.push(lag);
    }

    const avgLag = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    const maxLag = Math.max(...measurements);

    console.log(`    Average event loop lag: ${avgLag.toFixed(2)}ms`);
    console.log(`    Max event loop lag: ${maxLag}ms`);

    // Event loop should be responsive (< 10ms average)
    expect(avgLag).toBeLessThan(10);
  });

  runner.it('should handle concurrent operations without excessive memory', async () => {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const initialMemory = parseFloat(getMemoryUsageMB().heapUsed);

    // Create multiple concurrent operations
    const operations = Array(50).fill(null).map(() =>
      db.collection('characters').find({}).limit(5).toArray()
    );

    await Promise.all(operations);

    const finalMemory = parseFloat(getMemoryUsageMB().heapUsed);
    const memoryIncrease = finalMemory - initialMemory;

    console.log(`    50 concurrent operations completed`);
    console.log(`    Memory increase: ${memoryIncrease.toFixed(2)} MB`);

    expect(memoryIncrease).toBeLessThan(THRESHOLDS.MEMORY_LEAK_TOLERANCE);
  });

  runner.it('should measure JavaScript compilation time', async () => {
    const startTime = Date.now();

    // Import various modules to measure compilation overhead
    await import('../../api/v1/characters/index.js');
    await import('../../api/v1/assets/index.js');

    const duration = Date.now() - startTime;

    console.log(`    Module compilation took ${duration}ms`);

    // Should be reasonably fast
    expect(duration).toBeLessThan(1000);
  });

  runner.it('should report final resource usage', async () => {
    const memory = getMemoryUsageMB();
    const uptime = process.uptime();

    console.log('    Final resource report:');
    console.log(`      Process uptime: ${uptime.toFixed(2)}s`);
    console.log(`      RSS: ${memory.rss} MB`);
    console.log(`      Heap Used: ${memory.heapUsed} MB`);
    console.log(`      Heap Total: ${memory.heapTotal} MB`);
    console.log(`      Node version: ${process.version}`);
    console.log(`      Platform: ${process.platform}`);

    // Informational test - always passes
    expect(uptime).toBeGreaterThan(0);
  });

}).then(async () => {
  // Cleanup
  const { closeDB } = await import('../../plugins/mongo/mongo.js');
  await closeDB();
  process.exit(0);
}).catch(async (error) => {
  const { closeDB } = await import('../../plugins/mongo/mongo.js');
  await closeDB();
  process.exit(1);
});
