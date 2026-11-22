/**
 * Notes for Gantt entries: a hover tooltip on every bar/milestone (name, dates,
 * note) and – optionally – numbered footnotes below the chart, so the details
 * are also visible in PNG exports and prints where there is no hover.
 *
 * Works on a rendered Pele SVG (preview or export). Task ids come from gantt.js:
 * "pi1", "s3" (sprints) and "g0t2" (section 0, task 2).
 */
import { scheduleGantt } from './gantt.js';
import { formatDate } from './generator.js';

const SVG = 'http://www.w3.org/2000/svg';
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const superscript = (n) => String(n).replace(/\d/g, (d) => SUP[Number(d)]);

/** Entries that have a note, numbered in chart order. */
export function noteEntries(gantt) {
  const out = [];
  (gantt.sections ?? []).forEach((sec, si) =>
    sec.tasks.forEach((t, ti) => {
      if (String(t.note ?? '').trim()) out.push({ id: `g${si}t${ti}`, name: t.name.trim(), note: t.note.trim(), n: out.length + 1 });
    }),
  );
  return out;
}

function range(when, type) {
  if (!when) return '';
  if (type !== 'task' || when.start.getTime() === when.end.getTime()) return formatDate(when.start, 'long');
  return `${formatDate(when.start)} – ${formatDate(when.end, 'long')}`;
}

/** Wrap text into lines of at most `max` characters. */
export function wrap(text, max) {
  const lines = [];
  for (const para of String(text).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > max) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Add tooltips and (if enabled) footnotes to a rendered gantt chart, in place.
 * @param {SVGSVGElement} svg
 * @param {object} state app state
 */
export function addNotes(svg, state) {
  if (!svg?.classList.contains('pele-gantt')) return;
  const g = state.gantt;
  const { cal, dates } = scheduleGantt(g);
  const notes = noteEntries(g);
  const byId = new Map(notes.map((e) => [e.id, e]));
  const footnotes = g.showNotes !== false && notes.length > 0;

  for (const el of svg.querySelectorAll('g.pele-task[data-id]')) {
    const id = el.dataset.id;
    let lines = null;
    const m = /^g(\d+)t(\d+)$/.exec(id);
    if (m) {
      const task = g.sections[Number(m[1])]?.tasks[Number(m[2])];
      if (!task) continue;
      lines = [task.name.trim(), range(dates[Number(m[1])][Number(m[2])], task.type), String(task.note ?? '').trim(), task.link?.trim() ? `↗ ${task.link.trim()}` : ''];
      // linked entries: a small arrow after the name
      const label = el.querySelector('text.pele-label');
      if (task.link?.trim() && label) {
        const arrow = document.createElementNS(SVG, 'tspan');
        arrow.textContent = ' ↗';
        arrow.setAttribute('class', 'tb-link-ref');
        (label.querySelector('tspan:last-of-type') ?? label).append(arrow);
      }
    } else {
      const x = cal.pis.find((p) => p.id === id) ?? cal.sprints.find((s) => s.id === id);
      if (x) lines = [x.name, range(x, 'task')];
    }
    if (!lines) continue;
    // one tooltip per entry (replaces the "full label" tooltip of shortened labels)
    el.querySelector(':scope > title')?.remove();
    const title = document.createElementNS(SVG, 'title');
    title.textContent = lines.filter(Boolean).join('\n');
    el.prepend(title);

    const note = byId.get(id);
    const label = el.querySelector('text.pele-label');
    if (footnotes && note && label) {
      const sup = document.createElementNS(SVG, 'tspan');
      sup.textContent = ` ${superscript(note.n)}`;
      sup.setAttribute('class', 'tb-note-ref');
      (label.querySelector('tspan:last-of-type') ?? label).append(sup);
    }
  }
  if (footnotes) appendFootnotes(svg, notes);
  // links open in a new tab (keeps the editor / the viewed chart open)
  for (const a of svg.querySelectorAll('a[href]')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  }
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;

/** Text with clickable URLs: returns nodes (tspans and <a> elements) for a <text>. */
export function linkify(text) {
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElementNS(SVG, 'a');
    a.setAttribute('href', m[0]);
    const t = document.createElementNS(SVG, 'tspan');
    t.setAttribute('fill', 'var(--_c)');
    t.setAttribute('text-decoration', 'underline');
    t.textContent = m[0];
    a.append(t);
    nodes.push(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

/** Numbered notes below the chart; the SVG grows accordingly. */
function appendFootnotes(svg, notes) {
  const vb = svg.viewBox?.baseVal;
  const width = vb?.width || Number(svg.getAttribute('width')) || 800;
  const height = vb?.height || Number(svg.getAttribute('height')) || 400;
  const size = 12;
  const lineHeight = 17;
  const left = 16;
  const max = Math.max(30, Math.floor((width - 2 * left - 24) / (size * 0.55)));
  const group = document.createElementNS(SVG, 'g');
  group.setAttribute('class', 'tb-notes');
  group.setAttribute('font-size', String(size));
  let y = height + 4;
  const rule = document.createElementNS(SVG, 'path');
  rule.setAttribute('d', `M${left},${y}H${width - left}`);
  rule.setAttribute('stroke', 'var(--_b)');
  rule.setAttribute('fill', 'none');
  group.append(rule);
  y += 8;
  for (const e of notes) {
    wrap(`${e.name ? e.name + ' – ' : ''}${e.note}`, max).forEach((text, i) => {
      y += lineHeight;
      if (i === 0) {
        const ref = document.createElementNS(SVG, 'text');
        ref.setAttribute('x', String(left));
        ref.setAttribute('y', String(y));
        ref.setAttribute('fill', 'var(--_m)');
        ref.textContent = superscript(e.n);
        group.append(ref);
      }
      const t = document.createElementNS(SVG, 'text');
      t.setAttribute('x', String(left + 20));
      t.setAttribute('y', String(y));
      t.setAttribute('fill', 'var(--_fg)');
      t.append(...linkify(text));
      group.append(t);
    });
  }
  svg.append(group);
  const total = y + 12;
  svg.setAttribute('viewBox', `0 0 ${width} ${total}`);
  if (svg.hasAttribute('height')) svg.setAttribute('height', String(total));
}
