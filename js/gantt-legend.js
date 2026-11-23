/**
 * Legend for Gantt charts: one row below the time axis, right-aligned, with
 * only the elements that occur in the chart (statuses, milestones, deadlines,
 * links, notes). Section colours are not repeated – the section names on the
 * left already explain them. Status samples are neutral grey, because the real
 * bars take the colour of their section.
 *
 * Works on a rendered Pele SVG (preview or export), after styleGantt/alignTitle
 * and before addNotes (the notes go below the legend).
 */
import { noteEntries, superscript } from './gantt-notes.js';

const SVG = 'http://www.w3.org/2000/svg';
const STATUS_ORDER = ['', 'active', 'done', 'crit'];
const STATUS_LABEL = { '': 'Planned', active: 'In progress', done: 'Done', crit: 'Critical' };

/**
 * Legend entries for a gantt model, in display order.
 * @returns {{ kind: string, label: string }[]}
 */
export function legendItems(gantt) {
  const tasks = (gantt.sections ?? []).flatMap((s) => s.tasks);
  const bars = tasks.filter((t) => t.type === 'task');
  const statuses = new Set(bars.map((t) => t.status || ''));
  const items = [];
  // statuses only explain something if not everything is "planned"
  if ([...statuses].some((s) => s !== '')) {
    for (const s of STATUS_ORDER) if (statuses.has(s)) items.push({ kind: `status-${s || 'planned'}`, label: STATUS_LABEL[s] });
  }
  if (tasks.some((t) => t.type === 'milestone')) items.push({ kind: 'milestone', label: 'Milestone' });
  if (tasks.some((t) => t.type === 'deadline')) items.push({ kind: 'deadline', label: 'Deadline' });
  if (tasks.some((t) => t.link?.trim())) items.push({ kind: 'link', label: 'Link' });
  if (gantt.showNotes !== false && noteEntries(gantt).length) items.push({ kind: 'note', label: 'Note (below)' });
  return items;
}

const el = (name, attrs = {}, text) => {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
};

/** Small sample graphic for a legend entry, 16×12, top-left at (x, y). */
function sample(kind, x, y) {
  const grey = 'var(--_m)';
  const bar = (extra = {}) => el('rect', { x, y: y + 1, width: 16, height: 10, rx: 2, fill: grey, stroke: grey, ...extra });
  switch (kind) {
    case 'status-planned':
      return bar();
    case 'status-active':
      return bar({ stroke: 'var(--_fg)', 'stroke-width': 1.5 });
    case 'status-done':
      return bar({ 'fill-opacity': 0.35 });
    case 'status-crit':
      return bar({ fill: 'var(--pele-critical, #e45756)', stroke: 'var(--pele-critical, #e45756)' });
    case 'milestone':
      return el('path', { d: `M${x + 8},${y}L${x + 14},${y + 6}L${x + 8},${y + 12}L${x + 2},${y + 6}Z`, fill: grey });
    case 'deadline':
      return el('path', { d: `M${x + 8},${y - 2}V${y + 14}`, stroke: 'var(--_l)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', fill: 'none' });
    case 'link':
      return el('text', { x: x + 8, y: y + 11, 'text-anchor': 'middle', fill: 'var(--_fg)' }, '↗');
    case 'note':
      return el('text', { x: x + 8, y: y + 11, 'text-anchor': 'middle', fill: 'var(--_fg)' }, superscript(1));
    default:
      return el('g');
  }
}

/**
 * Append the legend below the chart (right-aligned) if enabled and not empty.
 * @param {SVGSVGElement} svg
 * @param {object} state app state
 */
export function addLegend(svg, state) {
  const g = state.gantt;
  if (!svg?.classList.contains('pele-gantt') || g?.showLegend === false) return;
  const items = legendItems(g);
  if (!items.length) return;
  const vb = svg.viewBox?.baseVal;
  const width = vb?.width || Number(svg.getAttribute('width')) || 800;
  const height = vb?.height || Number(svg.getAttribute('height')) || 400;
  const size = 12;
  const charW = size * 0.58;
  const margin = 16;
  const gap = 18;
  const itemW = (it) => 16 + 6 + Math.ceil(it.label.length * charW);
  // lay out right-aligned rows (wrap when wider than the chart)
  const rows = [[]];
  let rowW = 0;
  for (const it of items) {
    const w = itemW(it);
    if (rows.at(-1).length && rowW + gap + w > width - 2 * margin) {
      rows.push([]);
      rowW = 0;
    }
    rowW += (rows.at(-1).length ? gap : 0) + w;
    rows.at(-1).push(it);
  }
  const group = el('g', { class: 'tb-legend', 'font-size': size });
  const lineH = 20;
  let y = height + 6;
  for (const row of rows) {
    const total = row.reduce((sum, it, i) => sum + itemW(it) + (i ? gap : 0), 0);
    let x = width - margin - total;
    for (const it of row) {
      group.append(sample(it.kind, x, y));
      group.append(el('text', { x: x + 22, y: y + 10.5, fill: 'var(--_m)' }, it.label));
      x += itemW(it) + gap;
    }
    y += lineH;
  }
  svg.append(group);
  const total = y + 2;
  svg.setAttribute('viewBox', `0 0 ${width} ${total}`);
  if (svg.hasAttribute('height')) svg.setAttribute('height', String(total));
}
