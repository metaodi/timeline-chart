import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peleCss } from '../js/pele-css.js';
import { normalize } from '../js/model.js';
import { ganttExample } from '../js/examples.js';
import { PELE_DEFAULTS } from '../js/themes.js';

test('timeline: a complete .pele variable block, theme values over Pele defaults', () => {
  const css = peleCss(normalize({ theme: 'dark' }));
  assert.match(css, /^\/\* Pele playground CSS/);
  for (const name of Object.keys(PELE_DEFAULTS)) assert.ok(css.includes(`  ${name}: `), name);
  assert.match(css, /--pele-bg: #1e1f24;/); // dark preset
  assert.match(css, /--pele-series-8: /);
  assert.doesNotMatch(css, /pele-gantt/);
});

test('timeline: single colour option sets all series to the first colour', () => {
  const css = peleCss(normalize({ disableMulticolor: true }));
  assert.match(css, /--pele-series-1: #4c78a8;[\s\S]*--pele-series-8: #4c78a8;/);
});

test('gantt: PIs, sprints, sections, status and rows', () => {
  const state = normalize(ganttExample('2026-01-05'));
  state.gantt.sections[2].color = 6;
  state.gantt.rows = ['surface', 'mix'];
  const css = peleCss(state, new Set(['g0t1']));
  assert.match(css, /\.pele-task:is\(\[data-id="pi1"\], \[data-id="pi2"\]\) > :is\(rect, path\) \{\n  fill: var\(--pele-fg\);/);
  assert.match(css, /\[data-id="s10"\]\) > :is\(rect, path\) \{\n  fill: var\(--pele-muted\);/);
  assert.match(css, /\/\* Section "Checkout" \*\/[\s\S]*?fill: var\(--pele-series-1\);/);
  assert.match(css, /\/\* Section "Loyalty" \*\/[\s\S]*?fill: var\(--pele-series-6\);/); // chosen colour
  assert.match(css, /\.pele-done:not\(\.pele-crit\) > :is\(rect, path\) \{\n  fill-opacity: 0\.35;/);
  assert.match(css, /\.pele-task:is\(\[data-id="g0t1"\]\) > \.pele-label \{\n  fill: #ffffff;/); // active label on bar
  assert.match(css, /rect:nth-child\(odd\) \{\n  fill: #f3f3f3;[\s\S]*rect:nth-child\(even\) \{\n  fill: #f9f9f9;/);
});

test('gantt: section names cannot break out of CSS comments', () => {
  const state = normalize(ganttExample('2026-01-05'));
  state.gantt.sections[0].name = 'Evil */ .pele { display: none } /*';
  assert.doesNotMatch(peleCss(state), /\*\/ \.pele \{ display/);
});
