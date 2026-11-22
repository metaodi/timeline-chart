import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid, escapeItem, getKind, setKind, stripKind, isEmpty } from '../js/model.js';
import { parseMermaid } from '../js/parser.js';
import { generateSprints, nextName } from '../js/generator.js';
import { EXAMPLES } from '../js/examples.js';

test('serialises sections, periods, events and direction', () => {
  const code = toMermaid({
    title: 'Plan',
    direction: 'TD',
    sections: [{ name: 'PI 1\n5 Jan', periods: [{ label: 'Sprint 1', events: ['A', 'B\nC', ''] }] }],
  });
  assert.equal(
    code,
    'timeline TD\n  title Plan\n  section PI 1<br>5 Jan\n    Sprint 1 : A : B<br>C\n',
  );
});

test('ungrouped periods come before sections; LR is the default header', () => {
  const code = toMermaid({ periods: [{ label: '2024', events: ['x'] }], sections: [{ name: 'S', periods: [] }] });
  assert.match(code, /^timeline\n  2024 : x\n  section S\n$/);
});

test('frontmatter only for non-default config', () => {
  assert.doesNotMatch(toMermaid({ periods: [{ label: 'a', events: [] }] }), /---/);
  const code = toMermaid({ theme: 'forest', disableMulticolor: true, periods: [{ label: 'a', events: [] }] });
  assert.match(code, /^---\nconfig:\n  theme: forest\n  timeline:\n    disableMulticolor: true\n---\n/);
});

test('escapes characters that break the grammar', () => {
  assert.equal(escapeItem('Ratio: 3:1 #1'), 'Ratio#58; 3:1 #35;1');
});

test('round-trips every example through parse -> serialise -> parse', () => {
  for (const [name, code] of Object.entries(EXAMPLES).filter(([, v]) => typeof v === 'string')) {
    const { timeline, warnings } = parseMermaid(code);
    assert.deepEqual(warnings, [], name);
    assert.ok(!isEmpty(timeline), name);
    const again = parseMermaid(toMermaid(timeline)).timeline;
    assert.deepEqual(again, timeline, name);
  }
});

test('parses continuation lines, comments, acc fields and frontmatter', () => {
  const { timeline } = parseMermaid(`---
config:
  theme: dark
---
timeline LR
  %% a comment
  title T
  accTitle: Acc title
  accDescr {
    line one
    line two
  }
  2004 : Facebook
       : Google
  section Later
    2006 : Twitter #58; X
`);
  assert.equal(timeline.theme, 'dark');
  assert.equal(timeline.accTitle, 'Acc title');
  assert.equal(timeline.accDescr, 'line one\nline two');
  assert.deepEqual(timeline.periods, [{ label: '2004', events: ['Facebook', 'Google'] }]);
  assert.deepEqual(timeline.sections[0], { name: 'Later', periods: [{ label: '2006', events: ['Twitter : X'] }] });
});

test('item kinds are emoji prefixes', () => {
  assert.equal(getKind('🏁 Go live'), 'milestone');
  assert.equal(getKind('⚠ risk'), 'risk');
  assert.equal(getKind('plain'), 'item');
  assert.equal(setKind('🏁 Go live', 'deadline'), '⏰ Go live');
  assert.equal(setKind('⚠️ x', 'item'), 'x');
  assert.equal(stripKind('🚀 Release 2'), 'Release 2');
});

test('generates PIs with sprints, dates and IP iteration', () => {
  const s = generateSprints({ startDate: '2026-01-05', sprintCount: 5, sprintsPerPI: 4, ipIteration: true, firstPI: '2026.1' });
  assert.equal(s.length, 2);
  assert.equal(s[0].name, 'PI 2026.1\n5 Jan – 13 Mar');
  assert.deepEqual(s[0].periods.map((p) => p.label.split('\n')[0]), ['Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'IP Iteration']);
  assert.equal(s[0].periods[0].label, 'Sprint 1\n5 Jan – 16 Jan');
  assert.equal(s[1].name.split('\n')[0], 'PI 2026.2');
  assert.equal(s[1].periods[0].label, 'Sprint 5\n16 Mar – 27 Mar');
});

test('generates a flat sprint list without PIs', () => {
  const s = generateSprints({ startDate: '2026-01-05', sprintCount: 3, sprintsPerPI: 0, sprintWeeks: 3, dateStyle: 'none', sprintPrefix: 'Iteration' });
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].periods.map((p) => p.label), ['Iteration 1', 'Iteration 2', 'Iteration 3']);
});

test('nextName increments trailing numbers', () => {
  assert.equal(nextName('3'), '4');
  assert.equal(nextName('2026.1'), '2026.2');
  assert.equal(nextName('24-09'), '24-10');
});
