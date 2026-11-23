import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legendItems } from '../js/gantt-legend.js';
import { normalize } from '../js/model.js';
import { ganttExample } from '../js/examples.js';

const labels = (g) => legendItems(g).map((i) => i.label);

test('legend lists only what occurs, statuses in a fixed order', () => {
  const g = normalize(ganttExample('2026-01-05')).gantt; // planned, active, done, crit, milestones, a deadline
  assert.deepEqual(labels(g), ['Planned', 'In progress', 'Done', 'Critical', 'Milestone', 'Deadline']);
});

test('no status entries when everything is planned; links and notes when present', () => {
  const g = normalize({
    gantt: {
      calendar: { startDate: '2026-01-05' },
      sections: [{ name: 'S', tasks: [{ id: 'a', name: 'A', type: 'task', status: '', from: 'plan', duration: '1w', link: 'https://x' }] }],
    },
  }).gantt;
  assert.deepEqual(labels(g), ['Link']);
  g.sections[0].tasks[0].note = 'n';
  assert.deepEqual(labels(g), ['Link', 'Note (below)']);
  g.showNotes = false; // notes not listed below the chart → no marker to explain
  assert.deepEqual(labels(g), ['Link']);
});

test('legend toggle defaults to on and survives normalize', () => {
  assert.equal(normalize({ mode: 'gantt' }).gantt.showLegend, true);
  assert.equal(normalize({ gantt: { showLegend: false } }).gantt.showLegend, false);
});

test('own legend texts replace the defaults; empty means default', () => {
  const s = normalize(ganttExample('2026-01-05'));
  s.gantt.legendLabels = { 'status-done': 'Erledigt', 'status-active': '  ', milestone: 'Meilenstein' };
  const items = legendItems(s.gantt);
  assert.deepEqual(items.map((i) => i.label), ['Planned', 'In progress', 'Erledigt', 'Critical', 'Meilenstein', 'Deadline']);
  assert.equal(items.find((i) => i.kind === 'status-done').default, 'Done');
  // normalize keeps only real texts
  assert.deepEqual(normalize(s).gantt.legendLabels, { 'status-done': 'Erledigt', milestone: 'Meilenstein' });
});
