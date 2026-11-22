import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomProps, resolveValue, resolveStyle } from '../js/svg-vars.js';

const defs = parseCustomProps(
  '--pele-bg: #fffcf0; --pele-series-3:#54a24b; --_bg:var(--pele-bg,#fff); --_fg:var(--pele-fg,#1f1f1f); --_r:var(--pele-radius,4px); max-width:100%',
);

test('collects custom properties only', () => {
  assert.deepEqual([...defs.keys()], ['--pele-bg', '--pele-series-3', '--_bg', '--_fg', '--_r']);
});

test('resolves variables, chains and fallbacks', () => {
  assert.equal(resolveValue('var(--pele-series-3)', defs), '#54a24b');
  assert.equal(resolveValue('var(--_bg)', defs), '#fffcf0'); // chain to the theme value
  assert.equal(resolveValue('var(--_fg)', defs), '#1f1f1f'); // undefined -> fallback
  assert.equal(resolveValue('var(--pele-critical,#e45756)', defs), '#e45756');
  assert.equal(resolveValue('var(--nope, var(--pele-series-3))', defs), '#54a24b'); // nested fallback
  assert.equal(resolveValue('1px solid var(--_fg)', defs), '1px solid #1f1f1f');
  assert.equal(resolveValue('var(--unknown)', defs), '');
});

test('cyclic definitions do not loop', () => {
  const cyc = parseCustomProps('--a: var(--b, red); --b: var(--a, blue)');
  assert.ok(['red', 'blue'].includes(resolveValue('var(--a)', cyc))); // terminates with a fallback
});

test('styles: variables resolved, custom properties removed', () => {
  assert.equal(resolveStyle('--_bg:var(--pele-bg,#fff); color:var(--_fg); rx:var(--_r)', defs), 'color:#1f1f1f;rx:4px');
  assert.equal(resolveStyle('font-family:var(--pele-font,sans-serif)', defs), 'font-family:sans-serif');
});
