import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid, normalize } from '../js/model.js';
import { parseMermaid } from '../js/parser.js';
import { sprintCalendar } from '../js/generator.js';
import { taskLine, calendarOf, escapeGanttText } from '../js/gantt.js';
import { EXAMPLES, GANTT_EXAMPLE } from '../js/examples.js';

const calendar = { startDate: '2026-01-05', sprintWeeks: 2, sprintCount: 8, sprintsPerPI: 4, ipIteration: true, firstPI: '2026.1' };

test('sprint calendar: sprints, IP iterations and PIs with working-day ends', () => {
  const { sprints, pis } = sprintCalendar(calendar);
  assert.equal(sprints.length, 10);
  assert.deepEqual(sprints.map((s) => s.short), ['1', '2', '3', '4', 'IP', '5', '6', '7', '8', 'IP']);
  assert.equal(sprints[0].end.toISOString().slice(0, 10), '2026-01-16');
  assert.equal(pis[1].name, 'PI 2026.2');
  assert.equal(pis[1].start.toISOString().slice(0, 10), '2026-03-16');
});

test('a bar can span several sprints; milestones and deadlines are single dates', () => {
  const cal = calendarOf(normalize({ gantt: { calendar } }).gantt);
  assert.equal(taskLine({ name: 'Epic', type: 'task', status: 'crit', from: 's2', to: 's4' }, cal, 'g0t0'), '    Epic : crit, g0t0, 2026-01-19, 2026-02-27');
  assert.equal(taskLine({ name: 'Go-live', type: 'milestone', status: '', from: 's4', to: 's4' }, cal), '    Go-live : milestone, 2026-02-27, 0d');
  assert.equal(taskLine({ name: 'Freeze', type: 'deadline', status: '', from: '2026-02-13', to: '2026-02-13' }, cal), '    Freeze : vert, 2026-02-13, 0d');
  assert.equal(taskLine({ name: 'Gone', type: 'task', status: '', from: 's1', to: 's99' }, cal), null);
});

test('gantt output is compact (sprints side by side) and has short sprint labels', () => {
  const code = toMermaid({ mode: 'gantt', gantt: { calendar, sections: [{ name: 'Team', tasks: [{ name: 'A', from: 's1', to: 's2' }] }] } });
  assert.match(code, /^---\nconfig:\n  gantt:\n    displayMode: compact\n---\ngantt\n/);
  assert.match(code, /section Sprints\n    1 : s1, 2026-01-05, 2026-01-16\n/);
  assert.match(code, /    IP : s5, 2026-03-02, 2026-03-13\n/);
  assert.match(code, /section Team\n    A : g0t0, 2026-01-05, 2026-01-30\n/);
});

test('moving the calendar moves sprint-based tasks', () => {
  const base = { mode: 'gantt', gantt: { calendar, sections: [{ name: 'T', tasks: [{ name: 'A', from: 's2', to: 's3' }] }] } };
  const moved = structuredClone(base);
  moved.gantt.calendar.startDate = '2026-01-12';
  assert.match(toMermaid(base), /A : g0t0, 2026-01-19, 2026-02-13/);
  assert.match(toMermaid(moved), /A : g0t0, 2026-01-26, 2026-02-20/);
});

test('gantt import round-trips and restores sprint references', () => {
  const { timeline, warnings } = parseMermaid(EXAMPLES[GANTT_EXAMPLE]);
  assert.deepEqual(warnings, []);
  assert.equal(timeline.mode, 'gantt');
  assert.deepEqual(timeline.gantt.sections[0].tasks[1], { name: 'Checkout UI', type: 'task', status: 'active', from: 's2', to: 's4' });
  const code = toMermaid(timeline);
  assert.equal(toMermaid(parseMermaid(code).timeline), code);
});

test('gantt import handles durations, "after" and plain dates', () => {
  const { timeline } = parseMermaid(`gantt
  dateFormat YYYY-MM-DD
  section S
    A : a1, 2026-01-05, 10d
    B : after a1, 1w
    C : milestone, 2026-02-01, 0d
`);
  const [a, b, c] = timeline.gantt.sections[0].tasks;
  assert.deepEqual([a.from, a.to], ['2026-01-05', '2026-01-14']);
  assert.deepEqual([b.from, b.to], ['2026-01-15', '2026-01-21']);
  assert.deepEqual([c.type, c.to], ['milestone', '2026-02-01']);
});

test('gantt text escaping', () => {
  assert.equal(escapeGanttText('A: b; #1\nx'), 'A#58; b#59; #35;1 x');
});
