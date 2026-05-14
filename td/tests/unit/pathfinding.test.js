/**
 * Pathfinding tests.
 * Covers: straight path, blocked detours, no-path failure, off-path discouragement.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { findPath, findDefaultPath } from '../../services/pathfinding.js';

const baseMap = (overrides = {}) => ({
  radius: 6,
  spawnHexes: [{ q: -3, r: 0 }],
  baseHexes:  [{ q: 3, r: 0 }],
  pathHexes: [],
  blockedHexes: [],
  ...overrides,
});

test('findPath returns a path on an empty board', () => {
  const path = findPath(baseMap(), { q: -3, r: 0 }, { q: 3, r: 0 });
  assert.ok(Array.isArray(path));
  assert.strictEqual(path[0].q, -3);
  assert.strictEqual(path[path.length - 1].q, 3);
});

test('findPath returns null when goal is fully blocked', () => {
  // Block every neighbor of the goal
  const goal = { q: 3, r: 0 };
  const blockedHexes = [
    { q: 4, r: 0 }, { q: 4, r: -1 }, { q: 3, r: -1 },
    { q: 2, r: 0 }, { q: 2, r: 1 },  { q: 3, r: 1 },
  ];
  const path = findPath(baseMap({ blockedHexes }), { q: -3, r: 0 }, goal);
  assert.strictEqual(path, null);
});

test('findPath honors pathHexes preference', () => {
  // Two routes possible; the path lane should be chosen
  const pathHexes = [
    { q: -3, r: 0 }, { q: -2, r: 0 }, { q: -1, r: 0 },
    { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 },
  ];
  const path = findPath(baseMap({ pathHexes }), { q: -3, r: 0 }, { q: 3, r: 0 });
  assert.ok(path);
  // All path hexes should appear in result
  const set = new Set(path.map(h => `${h.q},${h.r}`));
  for (const ph of pathHexes) assert.ok(set.has(`${ph.q},${ph.r}`), `missing ${ph.q},${ph.r}`);
});

test('findDefaultPath uses first spawn and base', () => {
  const path = findDefaultPath(baseMap());
  assert.ok(path);
  assert.strictEqual(path[0].q, -3);
  assert.strictEqual(path[path.length - 1].q, 3);
});

test('findDefaultPath returns null when map missing spawn or base', () => {
  assert.strictEqual(findDefaultPath({ ...baseMap(), spawnHexes: [] }), null);
  assert.strictEqual(findDefaultPath({ ...baseMap(), baseHexes: [] }), null);
});
