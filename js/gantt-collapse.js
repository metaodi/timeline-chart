/**
 * "In my order" layout: Pele's normal (non-compact) Gantt layout keeps the
 * entries in the order of the editor, but gives every entry its own row – also
 * every PI and sprint (a "staircase"). This collapses the PI and sprint sections
 * into one row each, so sprints sit side by side again, and moves everything
 * below up.
 *
 * Works on a rendered Pele SVG (preview or export) before the other
 * post-processing steps. Assumes Pele's absolute coordinates: `y` attributes and
 * paths made of M/L/H/V commands.
 */
import { calendarOf } from './gantt.js';

/** Shift every y coordinate below `cutoff` by `dy` in a path's d attribute. */
export function shiftPath(d, cutoff, dy) {
  return d.replace(/([MLHV])([^MLHVZmlhvz]*)/g, (all, cmd, args) => {
    if (cmd === 'H') return all;
    const nums = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return all;
    const out = nums.map((n, i) => {
      const isY = cmd === 'V' || i % 2 === 1;
      return isY && n > cutoff ? +(n + dy).toFixed(2) : n;
    });
    if (cmd === 'V') return `V${out.join(' ')}`;
    const pairs = [];
    for (let i = 0; i < out.length; i += 2) pairs.push(`${out[i]},${out[i + 1]}`);
    return cmd + pairs.join(cmd === 'M' ? 'L' : cmd);
  });
}

/**
 * Collapse the sections that contain the given task ids into one row each.
 * @param {SVGSVGElement} svg rendered (non-compact) gantt chart
 * @param {string[][]} groups ids per section to collapse, e.g. [["pi1","pi2"], ["s1",…]]
 */
export function collapseRows(svg, groups) {
  if (!svg?.classList.contains('pele-gantt')) return;
  const bands = [...svg.querySelectorAll('rect.pele-section')];
  const labels = [...svg.querySelectorAll('text.pele-section-label')];
  let total = 0;
  for (const ids of groups) {
    const tasks = ids.map((id) => svg.querySelector(`g.pele-task[data-id="${id}"]`)).filter(Boolean);
    if (tasks.length < 2) continue;
    const rects = tasks.map((t) => t.querySelector('rect'));
    const first = Math.min(...rects.map((r) => Number(r.getAttribute('y'))));
    const band = bands.find((b) => {
      const y = Number(b.getAttribute('y'));
      return y <= first && first < y + Number(b.getAttribute('height'));
    });
    if (!band) continue;
    const top = Number(band.getAttribute('y'));
    const height = Number(band.getAttribute('height'));
    const row = height / tasks.length; // one row per entry in the normal layout
    // all entries of the section into its first row
    for (const t of tasks) {
      const r = t.querySelector('rect');
      const dy = first - Number(r.getAttribute('y'));
      for (const el of t.querySelectorAll('[y]')) el.setAttribute('y', String(+(Number(el.getAttribute('y')) + dy).toFixed(2)));
    }
    const removed = height - row;
    band.setAttribute('height', String(row));
    // the section name stays centred in the smaller band
    const label = labels.find((l) => {
      const y = Number(l.getAttribute('y'));
      return y > top && y < top + height;
    });
    if (label) label.setAttribute('y', String(+(Number(label.getAttribute('y')) - removed / 2).toFixed(2)));
    // everything below moves up (bands, tasks, labels, grid, axis, deadline lines)
    const bottom = top + height;
    for (const el of svg.querySelectorAll('[y]')) {
      if (el === label || tasks.some((t) => t.contains(el))) continue;
      const y = Number(el.getAttribute('y'));
      if (y >= bottom - 0.01) el.setAttribute('y', String(+(y - removed).toFixed(2)));
    }
    for (const el of svg.querySelectorAll('path[d]')) {
      if (tasks.some((t) => t.contains(el))) continue;
      el.setAttribute('d', shiftPath(el.getAttribute('d'), bottom - 0.01, -removed));
    }
    total += removed;
  }
  if (!total) return;
  const vb = svg.viewBox.baseVal;
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height - total}`);
  if (svg.hasAttribute('height')) svg.setAttribute('height', String(Number(svg.getAttribute('height')) - total));
}


/** Apply the "in my order" layout to a rendered chart: PI row and sprint row side by side. */
export function collapseCalendarRows(svg, state) {
  const g = state.gantt;
  if (state.mode !== 'gantt' || g?.layout !== 'ordered') return;
  const cal = calendarOf(g);
  collapseRows(svg, [g.showPIs ? cal.pis.map((p) => p.id) : [], g.showSprints ? cal.sprints.map((s) => s.id) : []]);
}
