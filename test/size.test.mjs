import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid, normalize } from '../js/model.js';
import { parseMermaid } from '../js/parser.js';
import { widthRange, cleanWidthRange } from '../js/gantt.js';
import { pngScale, cleanPngSize } from '../js/export.js';

const calendar = { startDate: '2026-01-05', sprintWeeks: 2, sprintCount: 8, sprintsPerPI: 4, ipIteration: true, firstPI: '2026.1' };
const chart = (extra = {}, sprintCount = 8) =>
  normalize({ mode: 'gantt', gantt: { calendar: { ...calendar, sprintCount }, sections: [], ...extra } });
const width = (state) => Number(/useWidth: (\d+)/.exec(toMermaid(state))[1]);

test('chart width: automatic range 1000–4000, or the user range', () => {
  assert.deepEqual(widthRange({}), { min: 1000, max: 4000, custom: false });
  assert.deepEqual(widthRange({ minWidth: 1500 }), { min: 1500, max: 4000, custom: true });
  assert.deepEqual(widthRange({ maxWidth: 800 }), { min: 800, max: 800, custom: true });
  assert.deepEqual(widthRange({ minWidth: 5000 }), { min: 5000, max: 5000, custom: true });
  // a short plan grows to the minimum, a long one is capped at the maximum
  assert.equal(width(chart({}, 2)), 1000);
  assert.equal(width(chart({ minWidth: 1600 }, 2)), 1600);
  assert.equal(width(chart({ maxWidth: 1200 }, 40)), 1200);
  assert.equal(width(chart({ minWidth: 1400, maxWidth: 1400 }, 40)), 1400);
});

test('chart width: cleaned (limits, swapped bounds) and round-trips through the Mermaid code', () => {
  assert.deepEqual(cleanWidthRange(2000, 1200), { minWidth: 1200, maxWidth: 2000 });
  assert.deepEqual(cleanWidthRange('x', 50), { minWidth: 0, maxWidth: 300 });
  assert.deepEqual(cleanWidthRange(-1, 99999), { minWidth: 0, maxWidth: 10000 });
  const s = chart({ minWidth: 2000, maxWidth: 1200 });
  assert.deepEqual([s.gantt.minWidth, s.gantt.maxWidth], [1200, 2000]);
  const code = toMermaid(s);
  assert.match(code, /%% chart-width 1200 2000\n/);
  const back = parseMermaid(code).timeline.gantt;
  assert.deepEqual([back.minWidth, back.maxWidth], [1200, 2000]);
  const half = parseMermaid(toMermaid(chart({ maxWidth: 1800 }))).timeline.gantt;
  assert.deepEqual([half.minWidth, half.maxWidth], [0, 1800]);
  assert.doesNotMatch(toMermaid(chart()), /chart-width/);
});

test('PNG size: density or target width, capped to what browsers can draw', () => {
  assert.equal(cleanPngSize('3X'), '3x');
  assert.equal(cleanPngSize('1920px'), '1920px');
  assert.equal(cleanPngSize('5x'), '');
  assert.equal(cleanPngSize('99999px'), '16384px');
  assert.equal(normalize({}).pngSize, '2x');
  assert.equal(normalize({ pngSize: 'huge' }).pngSize, '2x');
  assert.equal(pngScale(1000, 500, '3x'), 3);
  assert.equal(pngScale(1000, 500, '1920px'), 1.92);
  assert.equal(pngScale(1000, 500, ''), 2);
  // 4000 × 2000 at 4x would be 128 megapixels: reduced to ~16.7
  const s = pngScale(4000, 2000, '4x');
  assert.ok(4000 * s * 2000 * s <= 16777216 + 1 && s > 1);
});
