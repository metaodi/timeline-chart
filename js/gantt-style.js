/**
 * Make Pele's Gantt output look like the timeline diagram: bars take the
 * colour of their section (PIs and sprints by PI, teams by section) instead of
 * a single accent colour, statuses stay subtle, and labels that would run into
 * the next bar are shortened (full text on hover).
 *
 * Works on the DOM of a rendered SVG (preview or export). Task ids come from
 * gantt.js: "pi1", "s3" (sprints) and "g0t2" (section 0, task 2).
 */
import { calendarOf, sectionColour } from './gantt.js';
import { themeVars, rowColour } from './themes.js';

const CHAR_WIDTH = 0.56; // average glyph width relative to the font size

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 1-based series index of a section task ("g2t0"), or null. */
function seriesFor(id, gantt, cal) {
  const m = /^g(\d+)t\d+$/.exec(id);
  return m ? sectionColour(gantt, Number(m[1]), cal) : null;
}

/**
 * PIs and sprints are neutral, so colours are left to the categories:
 * PIs in the foreground colour (black in light themes), sprints in grey.
 */
function neutralFor(id, cal) {
  if (cal.pis.some((p) => p.id === id)) return 'var(--_fg)';
  if (cal.sprints.some((s) => s.id === id)) return 'var(--_m)';
  return null;
}

const num = (el, attr) => Number(el.getAttribute(attr)) || 0;

/**
 * @param {SVGSVGElement} svg rendered gantt chart
 * @param {object} state app state (gantt + theme)
 */
export function styleGantt(svg, state) {
  if (!svg?.classList.contains('pele-gantt')) return;
  const cal = calendarOf(state.gantt);
  const vars = themeVars(state.theme);
  const tasks = [...svg.querySelectorAll('g.pele-task[data-id]')];

  // Bars per row, to find the space available for labels drawn outside a bar.
  const rows = new Map();
  for (const g of tasks) {
    const rect = g.querySelector('rect');
    if (!rect) continue;
    const y = num(rect, 'y');
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(num(rect, 'x'));
  }
  const right = num(svg, 'width') || svg.viewBox?.baseVal?.width || Infinity;

  // Zebra stripes of the rows (configurable in the editor)
  const rowsCfg = state.gantt.rows ?? ['surface', 'none'];
  svg.querySelectorAll('rect.pele-section').forEach((band, i) => band.setAttribute('fill', rowColour(rowsCfg[i % 2], vars)));

  for (const g of tasks) {
    const k = seriesFor(g.dataset.id, state.gantt, cal);
    const neutral = neutralFor(g.dataset.id, cal);
    const shape = g.querySelector('rect, path');
    const label = g.querySelector('text.pele-label');
    const crit = g.classList.contains('pele-crit');
    const done = g.classList.contains('pele-done');
    const active = g.classList.contains('pele-active');

    if (neutral && shape) {
      shape.setAttribute('fill', neutral);
      shape.setAttribute('stroke', neutral);
      shape.removeAttribute('fill-opacity');
    }
    if (k && shape && !crit) {
      const colour = `var(--pele-series-${k})`;
      shape.setAttribute('fill', colour);
      shape.setAttribute('stroke', colour);
      shape.removeAttribute('fill-opacity');
      if (done) shape.setAttribute('fill-opacity', '0.35');
      if (active) {
        shape.setAttribute('stroke', 'var(--_fg)');
        shape.setAttribute('stroke-width', '1.5');
      }
    }

    const rect = g.querySelector('rect');
    if (!label || !rect) continue;
    const x = num(rect, 'x');
    const w = num(rect, 'width');
    const lx = num(label, 'x');
    const inside = lx >= x && lx <= x + w;
    if (inside) {
      if (neutral) label.setAttribute('fill', 'var(--_bg)');
      if (k && !crit) {
        const light = luminance(vars[`--pele-series-${k}`]) > 0.45;
        label.setAttribute('fill', done || light ? 'var(--_fg)' : '#ffffff');
      }
      continue;
    }
    // Label outside the bar: start right after it and stop before the next bar in the row.
    const end = x + w;
    const next = (rows.get(num(rect, 'y')) || []).filter((bx) => bx > end + 1).sort((a, b) => a - b)[0] ?? right;
    const size = Number(label.closest('[font-size]')?.getAttribute('font-size')) || 13;
    const full = label.textContent;
    const fits = Math.floor((next - end - 10) / (size * CHAR_WIDTH));
    label.setAttribute('text-anchor', 'start');
    label.setAttribute('x', String(end + 5));
    if (fits < full.length) {
      label.textContent = fits >= 2 ? full.slice(0, fits - 1).trimEnd() + '…' : '';
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = full;
      g.prepend(title);
    }
  }
}
