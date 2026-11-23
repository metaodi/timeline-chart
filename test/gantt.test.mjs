import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid, normalize } from '../js/model.js';
import { parseMermaid } from '../js/parser.js';
import { sprintCalendar } from '../js/generator.js';
import { taskLine, scheduleGantt, escapeGanttText, sectionColour } from '../js/gantt.js';
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
  assert.match(code, /^---\nconfig:\n  gantt:\n    displayMode: compact\n    useWidth: \d+\n---\ngantt\n/);
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

test('section colours: automatic after the PI colours, or chosen per section', () => {
  const state = normalize(plan([bar('A', 'plan', '1s')]));
  state.gantt.sections.push({ name: 'Ops', color: 0, tasks: [bar('B', 'plan', '1w')] }, { name: 'Dev', color: 3, tasks: [bar('C', 'plan', '1w')] });
  const g = state.gantt;
  assert.deepEqual([0, 1, 2].map((i) => sectionColour(g, i)), [1, 2, 3]); // automatic, or chosen (3)
  const code = toMermaid(state);
  assert.match(code, /%% section-colours 0,0,3\n/);
  assert.deepEqual(parseMermaid(code).timeline.gantt.sections.map((s) => s.color), [0, 0, 3]);
});

test('gantt width grows with the length of the plan', () => {
  const short = toMermaid(plan([bar('A', 'plan', '1s')], { calendar: { ...calendar, sprintCount: 2, sprintsPerPI: 0 } }));
  const long = toMermaid(plan([bar('A', 'plan', '1s')], { calendar: { ...calendar, sprintCount: 40, sprintsPerPI: 4 } }));
  const width = (code) => Number(/useWidth: (\d+)/.exec(code)[1]);
  assert.equal(width(short), 1000);
  assert.ok(width(long) > 3000 && width(long) <= 4000, String(width(long)));
});

test('row stripes: presets and custom colours, kept in the code', async () => {
  const { rowColour, mixHex, themeVars } = await import('../js/themes.js');
  const vars = themeVars('default');
  assert.equal(rowColour('surface', vars), '#f3f3f3');
  assert.equal(rowColour('none', vars), 'none');
  assert.equal(rowColour('mix', vars), '#f9f9f9'); // halfway between white and #f3f3f3
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(rowColour('#ABCDEF', vars), '#ABCDEF');
  const state = normalize(plan([bar('A', 'plan', '1s')]));
  assert.deepEqual(state.gantt.rows, ['surface', 'none']);
  assert.doesNotMatch(toMermaid(state), /row-colours/); // default: nothing extra
  state.gantt.rows = ['surface', 'mix'];
  const code = toMermaid(state);
  assert.match(code, /%% row-colours surface,mix\n/);
  assert.deepEqual(parseMermaid(code).timeline.gantt.rows, ['surface', 'mix']);
  assert.deepEqual(normalize({ gantt: { rows: ['bogus', '#123456'] } }).gantt.rows, ['surface', '#123456']);
});

test('milestones: written as a range centred on the date, read back as the date', () => {
  const when = { start: new Date('2026-02-10'), end: new Date('2026-02-10') };
  assert.equal(taskLine({ name: 'Go', type: 'milestone', status: '' }, when, 'x', 4), '    Go : milestone, x, 2026-02-06, 2026-02-13');
  assert.equal(taskLine({ name: 'Go', type: 'milestone', status: '' }, when, 'x', 0), '    Go : milestone, x, 2026-02-10, 0d');
  assert.equal(taskLine({ name: 'Freeze', type: 'deadline', status: '' }, when, 'x', 4), '    Freeze : vert, x, 2026-02-10, 0d');
  const { timeline } = parseMermaid('gantt\n  dateFormat YYYY-MM-DD\n  section S\n    Go : milestone, x, 2026-02-06, 2026-02-13\n');
  assert.equal(timeline.gantt.sections[0].tasks[0].from, '2026-02-10');
});

test('milestones close together get separate ranges that overlap (own rows), inside the chart', () => {
  const s = plan([
    bar('A', 'plan', '8s'),
    { id: 'm1', name: 'Go-live', type: 'milestone', status: '', from: '2026-02-10', duration: '', to: '' },
    { id: 'm2', name: 'Hypercare', type: 'milestone', status: '', from: '2026-02-11', duration: '', to: '' },
    { id: 'm3', name: 'Very last day', type: 'milestone', status: '', from: '2026-05-22', duration: '', to: '' },
  ]);
  const code = toMermaid(s);
  const range = (n) => code.match(new RegExp(`${n} : milestone, \\w+, ([\\d-]+), ([\\d-]+)`)).slice(1);
  const [a1, a2] = range('Go-live');
  const [b1] = range('Hypercare');
  assert.ok(b1 <= a2, 'ranges overlap, so the compact layout uses two rows');
  assert.ok(a1 < '2026-02-10' && a2 >= '2026-02-10');
  const [, c2] = range('Very last day');
  assert.ok(c2 <= '2026-05-22', 'range stays inside the chart (no longer time axis)');
});

test('bar looks and end dates: written as comments, restored on import', async () => {
  const { formatEndDate } = await import('../js/gantt.js');
  const t = (name, look, extra = {}) => ({ name, type: 'task', from: '2026-10-15', duration: '', to: '2026-11-09', look, ...extra });
  const state = {
    mode: 'gantt',
    gantt: {
      endDates: 'dmy',
      sections: [{ name: 'Work', tasks: [t('A', 'hatch'), t('B', 'option'), t('C', ''), { name: 'M', type: 'milestone', from: '2026-10-01', look: 'hatch' }] }],
    },
  };
  const code = toMermaid(state);
  assert.match(code, /%% task-looks \{"g0t0":"hatch","g0t1":"option"\}\n/); // not for milestones
  assert.match(code, /%% end-dates dmy\n/);
  const g = parseMermaid(code).timeline.gantt;
  assert.deepEqual(g.sections[0].tasks.map((x) => x.look), ['hatch', 'option', '', '']);
  assert.equal(g.endDates, 'dmy');
  // nothing written by default, unknown values dropped
  assert.doesNotMatch(toMermaid({ mode: 'gantt', gantt: { sections: [{ name: 'W', tasks: [t('A', '')] }] } }), /task-looks|end-dates/);
  const n = normalize({ mode: 'gantt', gantt: { endDates: 'xyz', sections: [{ name: 'W', tasks: [t('A', 'zigzag')] }] } });
  assert.equal(n.gantt.endDates, '');
  assert.equal(n.gantt.sections[0].tasks[0].look, '');
  // date formats
  const d = new Date(Date.UTC(2027, 2, 31));
  assert.equal(formatEndDate(d, 'dmy'), '31.03.2027');
  assert.equal(formatEndDate(d, 'iso'), '2027-03-31');
  assert.equal(formatEndDate(d, ''), '');
  assert.equal(formatEndDate(null, 'dmy'), '');
});

test('EBP example: EBP theme, end dates, hatched and dashed bars, round trip', async () => {
  const { EXAMPLES } = await import('../js/examples.js');
  const state = normalize(EXAMPLES['Gantt: EBP project']());
  assert.equal(state.theme, 'ebp');
  assert.equal(state.gantt.endDates, 'dmy');
  const looks = state.gantt.sections.flatMap((s) => s.tasks.map((t) => t.look)).filter(Boolean);
  assert.deepEqual(looks, ['hatch', 'option']);
  const back = parseMermaid(toMermaid(state)).timeline;
  assert.equal(back.theme, 'ebp');
  assert.deepEqual(back.gantt.sections.flatMap((s) => s.tasks.map((t) => [t.name, t.from, t.to, t.look])),
    state.gantt.sections.flatMap((s) => s.tasks.map((t) => [t.name, t.from, t.to, t.look])));
});

test('EBP offer example: steps as sprints of different lengths, durations in steps', async () => {
  const { EXAMPLES } = await import('../js/examples.js');
  const state = normalize(EXAMPLES['Gantt: EBP offer (steps)']());
  const { cal, dates } = scheduleGantt(state.gantt);
  assert.deepEqual(cal.sprints.map((s) => [s.name, s.weeks]), [['Schritt 1', 1], ['Schritt 2', 1], ['Schritt 3', 1], ['Schritt 4', 2], ['Schritt 5', 1]]);
  assert.equal(cal.pis.length, 0); // steps without a phase
  // "2nd revision" lasts one step = the two weeks of step 4
  const si = 0, ti = state.gantt.sections[0].tasks.findIndex((t) => t.id === 'ux2');
  assert.equal(dates[si][ti].start.toISOString().slice(0, 10), '2026-12-21');
  assert.equal(dates[si][ti].end.toISOString().slice(0, 10), '2027-01-01');
  const back = parseMermaid(toMermaid(state)).timeline;
  assert.deepEqual(back.gantt.pis.flatMap((p) => p.sprints.map((s) => s.weeks)), [1, 1, 1, 2, 1]);
  assert.equal(back.gantt.calendar.sprintPrefix, 'Schritt');
});

test('plural row labels for PI / sprint prefixes', async () => {
  const { plural } = await import('../js/gantt.js');
  assert.deepEqual(['Sprint', 'PI', 'Step', 'Schritt', 'Phase', 'Arbeitspaket', 'Iteration'].map(plural),
    ['Sprints', 'PIs', 'Steps', 'Schritte', 'Phasen', 'Arbeitspakete', 'Iterations']);
  assert.match(toMermaid(normalize((await import('../js/examples.js')).EXAMPLES['Gantt: EBP offer (steps)']())), /section Schritte\n/);
});
