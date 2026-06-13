/**
 * External Services Integration Tests
 * Tests connectivity to external services
 */

import { describe, expect } from '../utils/test-helpers.js';
import axios from 'axios';

await describe('External Services', runner => {
  runner.it('should connect to Game State Service', async () => {
    const svcUrl = process.env.GAME_STATE_SERVICE_URL || 'https://svc.madladslab.com';

    try {
      const response = await axios.get(`${svcUrl}/health`, { timeout: 5000 });
      expect(response.status).toBe(200);
    } catch (error) {
      throw new Error(`Game State Service unreachable: ${error.message}`);
    }
  });

  runner.it('should verify local server is running', async () => {
    try {
      const response = await axios.get('http://localhost:3399/health', {
        timeout: 2000,
        validateStatus: () => true
      });

      // Accept any response - just checking if server is up
      expect(response.status).toBeGreaterThan(0);
    } catch (error) {
      throw new Error(`Local server not responding: ${error.message}`);
    }
  });

  runner.it('should handle service timeout gracefully', async () => {
    try {
      await axios.get('http://localhost:9999', { timeout: 100 });
      throw new Error('Should have timed out');
    } catch (error) {
      // Expected to fail - either with timeout or connection refused
      const errorMsg = error.message.toLowerCase();
      const hasExpectedError = errorMsg.includes('timeout') || errorMsg.includes('econnrefused');
      if (!hasExpectedError) {
        throw new Error(`Expected timeout or connection error, got: ${error.message}`);
      }
    }
  });
});
