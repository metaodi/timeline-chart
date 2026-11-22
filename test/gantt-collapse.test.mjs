import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftPath } from '../js/gantt-collapse.js';
import { toMermaid, normalize } from '../js/model.js';
import { parseMermaid } from '../js/parser.js';
import { ganttExample } from '../js/examples.js';

test('shiftPath moves only y coordinates below the cutoff', () => {
  assert.equal(shiftPath('M137.1,48V648M231.7,48V648', 100, -240), 'M137.1,48V408M231.7,48V408');
  assert.equal(shiftPath('M89.8,648H1022.33', 100, -240), 'M89.8,408H1022.33');
  assert.equal(shiftPath('M351,411L363,423L351,435L339,423Z', 100, -300), 'M351,111L363,123L351,135L339,123Z');
  assert.equal(shiftPath('M10,20V30', 100, -50), 'M10,20V30'); // above the cutoff: unchanged
});

test('layout: "In my order" leaves out displayMode compact (and milestone ranges); import restores it', () => {
  const s = normalize(ganttExample('2026-01-05'));
  assert.match(toMermaid(s), /displayMode: compact/);
  s.gantt.layout = 'ordered';
  const code = toMermaid(s);
  assert.match(code, /^---\nconfig:\n  gantt:\n    useWidth: \d+\n---\n/);
  assert.match(code, /Release 3\.4 : milestone, g0t2, [\d-]+, 0d/);
  assert.equal(parseMermaid(code).timeline.gantt.layout, 'ordered');
  assert.equal(parseMermaid(toMermaid(normalize(ganttExample('2026-01-05')))).timeline.gantt.layout, 'compact');
});
