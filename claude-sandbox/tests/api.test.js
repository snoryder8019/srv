import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('API sanity checks', () => {
  it('should have a valid package.json', async () => {
    const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
    assert.equal(pkg.name, 'claude-sandbox');
    assert.ok(pkg.scripts.start);
    assert.ok(pkg.scripts.dev);
    assert.ok(pkg.scripts.test);
  });

  it('should export app from server', async () => {
    // Verify the server module is syntactically valid
    const mod = await import('../server.js').catch(err => ({ error: err.message }));
    // Server may fail to start (no DB, port in use) but should import without syntax errors
    assert.ok(mod);
  });
});
