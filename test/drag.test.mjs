import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveBetween } from '../js/drag.js';

test('moveBetween: within one list (index counts without the moved item)', () => {
  const a = ['a', 'b', 'c', 'd'];
  moveBetween(a, 0, a, 2); // drop between c and d
  assert.deepEqual(a, ['b', 'c', 'a', 'd']);
  moveBetween(a, 3, a, 0);
  assert.deepEqual(a, ['d', 'b', 'c', 'a']);
});

test('moveBetween: into another list, also empty, index clamped', () => {
  const a = ['a', 'b'];
  const b = [];
  moveBetween(a, 1, b, 5);
  assert.deepEqual([a, b], [['a'], ['b']]);
  moveBetween(a, 0, b, 0);
  assert.deepEqual([a, b], [[], ['a', 'b']]);
});
