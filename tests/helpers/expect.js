'use strict';

// A tiny Jest-style `expect` on top of node:assert, so tests read naturally
// while running on Node's built-in test runner (no extra dependency).
const assert = require('node:assert/strict');

function expect(actual) {
  const api = {
    toBe: (v) => assert.strictEqual(actual, v),
    toEqual: (v) => assert.deepStrictEqual(actual, v),
    toBeTruthy: () => assert.ok(actual),
    toBeFalsy: () => assert.ok(!actual),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toContain: (v) => assert.ok(actual.includes(v), `Expected ${JSON.stringify(String(actual).slice(0, 300))} to contain ${JSON.stringify(v)}`),
    toMatch: (re) => assert.match(String(actual), re),
    toHaveLength: (n) => assert.strictEqual(actual.length, n),
    toBeGreaterThan: (n) => assert.ok(actual > n, `Expected ${actual} > ${n}`),
    toBeGreaterThanOrEqual: (n) => assert.ok(actual >= n, `Expected ${actual} >= ${n}`),
    toBeLessThan: (n) => assert.ok(actual < n, `Expected ${actual} < ${n}`),
  };
  api.not = {
    toBe: (v) => assert.notStrictEqual(actual, v),
    toEqual: (v) => assert.notDeepStrictEqual(actual, v),
    toContain: (v) => assert.ok(!actual.includes(v), `Expected value not to contain ${JSON.stringify(v)}`),
    toMatch: (re) => assert.doesNotMatch(String(actual), re),
    toBeNull: () => assert.notStrictEqual(actual, null),
  };
  return api;
}

module.exports = { expect };
