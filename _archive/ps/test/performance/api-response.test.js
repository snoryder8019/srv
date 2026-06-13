/**
 * API Response Performance Tests
 * Tests API endpoint response times and throughput
 */

import { describe, expect } from '../utils/test-helpers.js';
import axios from 'axios';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  HEALTH_CHECK: 50,       // Health/status endpoints
  SIMPLE_GET: 200,        // Simple GET requests
  API_ENDPOINT: 500,      // Standard API endpoints
  HEAVY_ENDPOINT: 1000    // Complex/heavy endpoints
};

const BASE_URL = process.env.BASE_URL || 'http://localhost:3399';
const GAME_STATE_URL = process.env.GAME_STATE_SERVICE_URL || 'https://svc.madladslab.com';

await describe('API Response Performance', runner => {
  runner.it('should respond to health check quickly', async () => {
    const startTime = Date.now();

    try {
      const response = await axios.get(`${BASE_URL}/health`, {
        timeout: 5000,
        validateStatus: () => true
      });
      const duration = Date.now() - startTime;

      console.log(`    Health check took ${duration}ms (status: ${response.status})`);
      expect(duration).toBeLessThan(THRESHOLDS.HEALTH_CHECK);
    } catch (error) {
      // If health endpoint doesn't exist, check root
      const response = await axios.get(`${BASE_URL}/`, {
        timeout: 5000,
        validateStatus: () => true
      });
      const duration = Date.now() - startTime;

      console.log(`    Root endpoint took ${duration}ms (status: ${response.status})`);
      expect(duration).toBeLessThan(THRESHOLDS.SIMPLE_GET);
    }
  });

  runner.it('should load static pages efficiently', async () => {
    const startTime = Date.now();

    const response = await axios.get(`${BASE_URL}/`, {
      timeout: 5000,
      validateStatus: () => true
    });
    const duration = Date.now() - startTime;

    console.log(`    Static page load took ${duration}ms`);
    expect(duration).toBeLessThan(THRESHOLDS.SIMPLE_GET);
    expect(response.status).toBeGreaterThan(0);
  });

  runner.it('should handle concurrent requests efficiently', async () => {
    const startTime = Date.now();
    const numRequests = 10;

    const requests = Array(numRequests).fill(null).map(() =>
      axios.get(`${BASE_URL}/`, {
        timeout: 5000,
        validateStatus: () => true
      }).catch(() => ({ status: 0 }))
    );

    const responses = await Promise.all(requests);
    const duration = Date.now() - startTime;
    const avgDuration = duration / numRequests;

    console.log(`    ${numRequests} concurrent requests took ${duration}ms (avg: ${avgDuration.toFixed(2)}ms)`);

    const successful = responses.filter(r => r.status > 0).length;
    console.log(`    ${successful}/${numRequests} requests successful`);

    expect(avgDuration).toBeLessThan(THRESHOLDS.API_ENDPOINT);
  });

  runner.it('should connect to Game State Service efficiently', async () => {
    const startTime = Date.now();

    try {
      const response = await axios.get(`${GAME_STATE_URL}/health`, {
        timeout: 5000,
        validateStatus: () => true
      });
      const duration = Date.now() - startTime;

      console.log(`    Game State Service response took ${duration}ms`);
      expect(duration).toBeLessThan(THRESHOLDS.API_ENDPOINT);
      expect(response.status).toBe(200);
    } catch (error) {
      throw new Error(`Game State Service unreachable: ${error.message}`);
    }
  });

  runner.it('should measure API endpoint latency distribution', async () => {
    const numRequests = 20;
    const durations = [];

    for (let i = 0; i < numRequests; i++) {
      const startTime = Date.now();
      await axios.get(`${BASE_URL}/`, {
        timeout: 5000,
        validateStatus: () => true
      }).catch(() => ({}));
      durations.push(Date.now() - startTime);
    }

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const median = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)];

    console.log(`    Latency distribution (${numRequests} requests):`);
    console.log(`      Min: ${min}ms`);
    console.log(`      Max: ${max}ms`);
    console.log(`      Avg: ${avg.toFixed(2)}ms`);
    console.log(`      Median: ${median}ms`);

    // Average should be within threshold
    expect(avg).toBeLessThan(THRESHOLDS.SIMPLE_GET);
  });

  runner.it('should handle request timeouts gracefully', async () => {
    const startTime = Date.now();

    try {
      // Attempt connection to non-existent port
      await axios.get('http://localhost:9999', { timeout: 200 });
      throw new Error('Should have failed');
    } catch (error) {
      const duration = Date.now() - startTime;

      // Should fail quickly (timeout or connection refused)
      console.log(`    Failed request took ${duration}ms`);
      expect(duration).toBeLessThan(300);

      const errorMsg = error.message.toLowerCase();
      const hasExpectedError = errorMsg.includes('timeout') ||
                               errorMsg.includes('econnrefused') ||
                               errorMsg.includes('network');
      expect(hasExpectedError).toBeTruthy();
    }
  });

  runner.it('should measure response payload sizes', async () => {
    const response = await axios.get(`${BASE_URL}/`, {
      timeout: 5000,
      validateStatus: () => true
    });

    const contentLength = response.headers['content-length'] ||
                         (response.data ? JSON.stringify(response.data).length : 0);

    console.log(`    Response size: ${contentLength} bytes`);
    console.log(`    Response status: ${response.status}`);

    // Informational test - always passes
    expect(response.status).toBeGreaterThan(0);
  });
});
