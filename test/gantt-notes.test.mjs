import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteEntries, wrap, superscript } from '../js/gantt-notes.js';
import { toMermaid, normalize } from '../js/model.js';
import { parseMermaid } from '../js/parser.js';
import { ganttExample } from '../js/examples.js';

test('notes are numbered in chart order', () => {
  const s = normalize(ganttExample('2026-01-05'));
  s.gantt.sections[2].tasks[0].note = 'Needs the loyalty API';
  s.gantt.sections[0].tasks[1].note = '  Depends on design review  ';
  assert.deepEqual(noteEntries(s.gantt), [
    { id: 'g0t1', name: 'Checkout UI', note: 'Depends on design review', n: 1 },
    { id: 'g2t0', name: 'Loyalty points MVP', note: 'Needs the loyalty API', n: 2 },
  ]);
});

test('superscript numbers and word wrapping', () => {
  assert.equal(superscript(12), '¹²');
  assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrap('a\nb', 10), ['a', 'b']);
});

test('notes survive the Mermaid code (comment), including "hidden below chart"', () => {
  const s = normalize(ganttExample('2026-01-05'));
  s.gantt.sections[0].tasks[1].note = 'Line 1\nLine "2": #3';
  s.gantt.showNotes = false;
  const code = toMermaid(s);
  assert.match(code, /%% notes \{"g0t1":"Line 1\\nLine \\"2\\": #3"\} hidden\n/);
  const back = parseMermaid(code).timeline.gantt;
  assert.equal(back.sections[0].tasks[1].note, 'Line 1\nLine "2": #3');
  assert.equal(back.showNotes, false);
  assert.equal(back.sections[0].tasks[0].note, '');
  assert.equal(toMermaid(parseMermaid(code).timeline), code);
});

test('links: Mermaid "click … href" lines, read back on import', () => {
  const s = normalize(ganttExample('2026-01-05'));
  s.gantt.sections[0].tasks[1].link = 'https://jira.example.com/browse/CHK-12?x="1"';
  const code = toMermaid(s);
  assert.match(code, /\n  click g0t1 href "https:\/\/jira\.example\.com\/browse\/CHK-12\?x=%221%22"\n$/);
  const back = parseMermaid(code).timeline.gantt;
  assert.equal(back.sections[0].tasks[1].link, 'https://jira.example.com/browse/CHK-12?x=%221%22');
  assert.equal(back.sections[0].tasks[0].link, '');
  assert.equal(toMermaid(parseMermaid(code).timeline), code);
});
