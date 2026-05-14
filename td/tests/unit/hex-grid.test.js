/**
 * Smoke test for hex grid math.
 * Run with: node --test tests/unit/hex-grid.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  axialToWorld,
  worldToAxial,
  hexDistance,
  hexNeighbors,
  generateHexBoard,
  hexKey,
} from '../../services/hex-grid.js';

test('axial→world→axial roundtrip', () => {
  for (const { q, r } of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -5, r: 5 }]) {
    const { x, z } = axialToWorld(q, r);
    const back = worldToAxial(x, z);
    assert.strictEqual(back.q, q);
    assert.strictEqual(back.r, r);
  }
});

test('hexDistance origin to neighbor = 1', () => {
  for (const n of hexNeighbors({ q: 0, r: 0 })) {
    assert.strictEqual(hexDistance({ q: 0, r: 0 }, n), 1);
  }
});

test('generateHexBoard radius=1 has 7 hexes', () => {
  assert.strictEqual(generateHexBoard(1).length, 7);
});

test('generateHexBoard radius=6 has 127 hexes', () => {
  // 1 + 6*sum(1..6) = 1 + 6*21 = 127
  assert.strictEqual(generateHexBoard(6).length, 127);
});

test('hexKey is stable', () => {
  assert.strictEqual(hexKey(3, -2), '3,-2');
});
