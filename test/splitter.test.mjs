import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampEditorWidth, EDITOR_MIN, PREVIEW_MIN } from '../js/splitter.js';

test('clampEditorWidth: keeps widths in range and rounds', () => {
  assert.equal(clampEditorWidth(500.4, 1400), 500);
  assert.equal(clampEditorWidth(100, 1400), EDITOR_MIN);
  assert.equal(clampEditorWidth(5000, 1400), 1400 - PREVIEW_MIN);
  assert.equal(clampEditorWidth(Infinity, 1400), 1400 - PREVIEW_MIN);
});

test('clampEditorWidth: narrow layouts never go below the minimum', () => {
  assert.equal(clampEditorWidth(400, 500), EDITOR_MIN);
});
