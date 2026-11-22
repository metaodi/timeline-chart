import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid, normalize } from '../js/model.js';
import { parseMermaid } from '../js/parser.js';
import { sprintCalendar } from '../js/generator.js';
import { taskLine, scheduleGantt, escapeGanttText } from '../js/gantt.js';
import { ganttExample } from '../js/examples.js';

const calendar = { startDate: '2026-01-05', sprintWeeks: 2, sprintCount: 8, sprintsPerPI: 4, ipIteration: true, firstPI: '2026.1' };

test('sprint calendar: sprints, IP iterations and PIs with working-day ends', () => {
  const { sprints, pis } = sprintCalendar(calendar);
  assert.equal(sprints.length, 10);
  assert.deepEqual(sprints.map((s) => s.short), ['1', '2', '3', '4', 'IP', '5', '6', '7', '8', 'IP']);
  assert.equal(sprints[0].end.toISOString().slice(0, 10), '2026-01-16');
  assert.equal(pis[1].name, 'PI 2026.2');
  assert.equal(pis[1].start.toISOString().slice(0, 10), '2026-03-16');
});

const plan = (tasks, extra = {}) => ({ mode: 'gantt', gantt: { calendar, sections: [{ name: 'T', tasks }], ...extra } });
const bar = (id, from, duration, to = '') => ({ id, name: id, type: 'task', status: '', from, duration, to });
const datesOf = (state) =>
  scheduleGantt(state.gantt).dates[0].map((d) => d && `${d.start.toISOString().slice(0, 10)}..${d.end.toISOString().slice(0, 10)}`);

test('durations: bars chain after the previous one, starting at the plan start', () => {
  const s = plan([bar('a', 'plan', '2s'), bar('b', 'prev', '3w'), bar('c', 'prev', '5d'), bar('d', 'prev', '1s')]);
  assert.deepEqual(datesOf(s), [
    '2026-01-05..2026-01-30', // 2 sprints, aligned with sprint 1
    '2026-02-02..2026-02-20', // 3 weeks
    '2026-02-23..2026-02-27', // 5 working days
    '2026-03-02..2026-03-13', // 1 sprint (= the IP iteration here)
  ]);
});

test('durations: working days skip weekends; sprint starts, "after", "until" and dates', () => {
  const s = plan([
    bar('a', '2026-01-08', '5d'), // Thu -> next Wed
    bar('b', 's3', '2s'),
    bar('c', 'after:a', '1w'),
    bar('d', 's2', '', 's4'),
    { id: 'm', name: 'M', type: 'milestone', status: '', from: 'after:b', duration: '', to: '' },
    { id: 'v', name: 'V', type: 'deadline', status: '', from: 's1', duration: '', to: '' },
  ]);
  assert.deepEqual(datesOf(s), [
    '2026-01-08..2026-01-14',
    '2026-02-02..2026-02-27',
    '2026-01-15..2026-01-21',
    '2026-01-19..2026-02-27',
    '2026-02-27..2026-02-27',
    '2026-01-16..2026-01-16',
  ]);
});

test('scheduling: circular "after" chains and missing plan start do not crash', () => {
  const s = plan([bar('a', 'after:b', '1w'), bar('b', 'after:a', '1w')]);
  assert.deepEqual(datesOf(s), [null, null]);
  const noStart = plan([bar('a', 'plan', '1w')]);
  noStart.gantt.calendar = { ...calendar, startDate: '' };
  assert.deepEqual(datesOf(noStart), [null]);
});

test('task lines use the computed dates', () => {
  const when = { start: new Date('2026-01-19'), end: new Date('2026-02-27') };
  assert.equal(taskLine({ name: 'Epic', type: 'task', status: 'crit' }, when, 'g0t0'), '    Epic : crit, g0t0, 2026-01-19, 2026-02-27');
  assert.equal(taskLine({ name: 'Go-live', type: 'milestone', status: '' }, when), '    Go-live : milestone, 2026-01-19, 0d');
  assert.equal(taskLine({ name: 'Freeze', type: 'deadline', status: '' }, when), '    Freeze : vert, 2026-01-19, 0d');
  assert.equal(taskLine({ name: 'Gone', type: 'task' }, null), null);
});

test('gantt output is compact (sprints side by side) and has short sprint labels', () => {
  const code = toMermaid({ mode: 'gantt', gantt: { calendar, sections: [{ name: 'Team', tasks: [bar('A', 's1', '', 's2')] }] } });
  assert.match(code, /^---\nconfig:\n  gantt:\n    displayMode: compact\n---\ngantt\n/);
  assert.match(code, /section Sprints\n    1 : s1, 2026-01-05, 2026-01-16\n/);
  assert.match(code, /    IP : s5, 2026-03-02, 2026-03-13\n/);
  assert.match(code, /section Team\n    A : g0t0, 2026-01-05, 2026-01-30\n/);
});

test('moving the calendar moves sprint-based tasks', () => {
  const base = plan([bar('A', 's2', '2s')]);
  const moved = structuredClone(base);
  moved.gantt.calendar.startDate = '2026-01-12';
  assert.match(toMermaid(base), /A : g0t0, 2026-01-19, 2026-02-13/);
  assert.match(toMermaid(moved), /A : g0t0, 2026-01-26, 2026-02-20/);
});

test('gantt import round-trips and restores sprint references', () => {
  const code = toMermaid(ganttExample('2026-01-05'));
  const { timeline, warnings } = parseMermaid(code);
  assert.deepEqual(warnings, []);
  assert.equal(timeline.mode, 'gantt');
  const ui = timeline.gantt.sections[0].tasks[1];
  assert.deepEqual([ui.name, ui.status, ui.from, ui.duration, ui.to], ['Checkout UI', 'active', 's3', '', 's4']);
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
  assert.deepEqual([c.type, c.from], ['milestone', '2026-02-01']);
});

test('gantt text escaping', () => {
  assert.equal(escapeGanttText('A: b; #1\nx'), 'A#58; b#59; #35;1 x');
});

test('sprint plan: generated from settings, then editable (names, lengths, PIs)', () => {
  const state = normalize(plan([bar('A', 's2', '2s')]));
  const pis = state.gantt.pis;
  assert.deepEqual(pis.map((p) => [p.name, p.sprints.length]), [['PI 2026.1', 5], ['PI 2026.2', 5]]);
  // rename a sprint, make sprint 1 three weeks long, rename a PI
  pis[0].sprints[1].name = 'Hardening';
  pis[0].sprints[0].weeks = 3;
  pis[1].name = 'Summer PI';
  const code = toMermaid(state);
  assert.match(code, /    1 : s1, 2026-01-05, 2026-01-23\n    Hardening : s2, 2026-01-26, 2026-02-06\n/);
  assert.match(code, /    Summer PI : pi2, 2026-03-23, /);
  // the task referencing s2 follows the sprint (2 sprints from s2)
  assert.match(code, /A : g0t0, 2026-01-26, 2026-02-20/);
  // import restores the edited plan
  const back = parseMermaid(code).timeline.gantt.pis;
  assert.deepEqual(back, pis);
});

test('sprint plan: PI without a name groups sprints without a PI row entry', () => {
  const state = normalize(plan([bar('A', 'plan', '1s')]));
  state.gantt.pis = [{ id: 'pi1', name: '', sprints: [{ id: 's1', name: 'Sprint 7', weeks: 2 }, { id: 's2', name: 'Release week', weeks: 1 }] }];
  const code = toMermaid(state);
  assert.doesNotMatch(code, /section PIs/);
  assert.match(code, /section Sprints\n    7 : s1, 2026-01-05, 2026-01-16\n    Release week : s2, 2026-01-19, 2026-01-23\n/);
});

test('sprint numbering can restart in every PI', () => {
  const { sprints } = sprintCalendar({ ...calendar, restartNumbering: true });
  assert.deepEqual(sprints.map((s) => s.name), [
    'Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'IP Iteration',
    'Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'IP Iteration',
  ]);
  const code = toMermaid(plan([bar('A', 's6', '1s')], { calendar: { ...calendar, restartNumbering: true } }));
  assert.match(code, /restart=1/);
  assert.equal(parseMermaid(code).timeline.gantt.calendar.restartNumbering, true);
});
