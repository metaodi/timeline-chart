/**
 * Make Pele's Gantt output look like the timeline diagram: bars take the
 * colour of their section (PIs and sprints by PI, teams by section) instead of
 * a single accent colour, statuses stay subtle, and labels that would run into
 * the next bar are shortened (full text on hover). Bars can be hatched
 * (independent work package) or dashed (option), and bars and milestones can
 * show their end date after a dot.
 *
 * Works on the DOM of a rendered SVG (preview or export). Task ids come from
 * gantt.js: "pi1", "s3" (sprints) and "g0t2" (section 0, task 2).
 */
import { calendarOf, sectionColour, scheduleGantt, formatEndDate, showsEndDate } from './gantt.js';
import { themeVars, rowColour, themeColour, mixHex } from './themes.js';

const SVG = 'http://www.w3.org/2000/svg';
const CHAR_WIDTH = 0.56; // average glyph width relative to the font size

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** Rendered width of a text node (estimated when the SVG is not in the document, e.g. on export). */
function textWidth(node, size) {
  try {
    const w = node.getComputedTextLength?.();
    if (w > 0) return w;
  } catch {
    /* not rendered */
  }
  return node.textContent.length * size * CHAR_WIDTH;
}

/** Diagonal hatch in a colour (light fill, darker lines), defined once per SVG. */
function hatchPattern(svg, colour) {
  const id = `tb-hatch-${colour.replace('#', '')}`;
  if (svg.querySelector(`pattern#${id}`)) return id;
  let defs = svg.querySelector(':scope > defs');
  if (!defs) svg.prepend((defs = el('defs')));
  const p = el('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  p.append(el('rect', { width: 8, height: 8, fill: mixHex(colour, '#ffffff', 0.55) }));
  p.append(el('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: mixHex(colour, '#000000', 0.25), 'stroke-width': 1.5 }));
  defs.append(p);
  return id;
}

/** Concrete #rrggbb of a bar (series colour, or the critical colour). */
function barHex(vars, k, crit) {
  const c = crit ? themeColour(vars, '--pele-critical') : vars[`--pele-series-${k}`];
  return /^#[0-9a-f]{6}$/i.test(c ?? '') ? c : '#888888';
}

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
  if (!svg?.classList.contains('pele-gantt')) return new Set();
  const insideLabels = new Set(); // ids of tasks whose label sits on the bar (for pele-css.js)
  const cal = calendarOf(state.gantt);
  const vars = themeVars(state.theme);
  const tasks = [...svg.querySelectorAll('g.pele-task[data-id]')];
  const { dates } = scheduleGantt(state.gantt);
  const endFormat = state.gantt.endDates ? state.gantt.endDateFormat || 'dmy' : '';
  let maxRight = 0; // right edge of the end dates (the chart grows to fit them)
  const taskOf = (id) => {
    const m = /^g(\d+)t(\d+)$/.exec(id);
    return m ? { task: state.gantt.sections[m[1]]?.tasks[m[2]], when: dates[m[1]]?.[m[2]] } : {};
  };

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

    const { task, when } = taskOf(g.dataset.id);
    const look = task?.type === 'task' ? task.look : '';
    const rect = g.querySelector('rect');
    if (look && rect) {
      const hex = barHex(vars, k, crit);
      if (look === 'hatch') {
        rect.setAttribute('fill', `url(#${hatchPattern(svg, hex)})`);
        rect.setAttribute('stroke', hex);
        rect.setAttribute('stroke-width', '1.5');
      } else {
        rect.setAttribute('fill', 'var(--_bg)');
        rect.setAttribute('stroke', hex);
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('stroke-dasharray', '5 3');
      }
      if (done) rect.setAttribute('fill-opacity', '0.35');
      rect.setAttribute('class', `${rect.getAttribute('class') ?? ''} tb-${look}`.trim());
    }
    if (!label) continue;
    const size = Number(label.closest('[font-size]')?.getAttribute('font-size')) || 13;
    const dateText = showsEndDate(state.gantt, task) ? formatEndDate(when?.end, endFormat) : '';
    const dateWidth = dateText.length * size * CHAR_WIDTH; // estimate, measured once drawn

    if (!rect) {
      // Milestone: the date right of the diamond, then the label (Pele may put it left of a late milestone).
      const xs = (shape?.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
      if (dateText && xs.length) {
        const dx = Math.max(...xs) + 6;
        const date = el('text', { x: dx, y: label.getAttribute('y'), class: 'tb-end-date', 'text-anchor': 'start', fill: 'var(--_fg)' });
        date.textContent = dateText;
        label.before(date);
        const lx = dx + textWidth(date, size) + 8;
        label.setAttribute('text-anchor', 'start');
        label.setAttribute('x', String(lx));
        maxRight = Math.max(maxRight, lx + textWidth(label, size));
      }
      continue;
    }
    const x = num(rect, 'x');
    const w = num(rect, 'width');
    const lx = num(label, 'x');
    const inside = lx >= x && lx <= x + w;
    const end = x + w;
    const next = (rows.get(num(rect, 'y')) || []).filter((bx) => bx > end + 1).sort((a, b) => a - b)[0];

    // End date: a dot on the bar's end, the date right after it (unless the next bar is in the way)
    let after = end; // where an outside label may start
    if (dateText) {
      const h = num(rect, 'height');
      const cy = num(rect, 'y') + h / 2;
      const r = Math.max(3, Math.min(6, h * 0.3));
      const dateEnd = end + r + 4 + dateWidth;
      const dot = el('circle', { cx: end, cy, r, class: 'tb-end-dot', fill: look === 'option' ? 'var(--_bg)' : 'var(--_m)', stroke: 'var(--_m)', 'stroke-width': 1.5 });
      g.append(dot);
      if (next === undefined || dateEnd + 4 < next) {
        const date = el('text', { x: end + r + 4, y: cy, class: 'tb-end-date', 'text-anchor': 'start', 'dominant-baseline': 'central', fill: 'var(--_fg)' });
        date.textContent = dateText;
        g.append(date);
        const drawnEnd = end + r + 4 + textWidth(date, size);
        after = drawnEnd + 4;
        maxRight = Math.max(maxRight, drawnEnd);
      } else {
        after = end + r;
      }
    }

    if (inside) {
      insideLabels.add(g.dataset.id);
      if (neutral) label.setAttribute('fill', 'var(--_bg)');
      if (k && !crit) {
        const light = luminance(vars[`--pele-series-${k}`]) > 0.45;
        label.setAttribute('fill', done || light || look ? 'var(--_fg)' : '#ffffff');
      }
      if (crit && look) label.setAttribute('fill', 'var(--_fg)');
      if (look === 'hatch') {
        // a halo in the background colour keeps the label readable on the hatching
        label.setAttribute('stroke', 'var(--_bg)');
        label.setAttribute('stroke-width', '3');
        label.setAttribute('stroke-linejoin', 'round');
        label.setAttribute('paint-order', 'stroke');
      }
      continue;
    }
    // Label outside the bar: start right after it (or its end date) and stop before the next bar in the row.
    const full = label.textContent;
    // with end dates the chart grows on the right anyway, so the last label in a row keeps its full text
    const limit = next ?? (endFormat ? Infinity : right);
    const fits = Math.floor((limit - after - 10) / (size * CHAR_WIDTH));
    if (limit === Infinity) maxRight = Math.max(maxRight, after + 5 + textWidth(label, size));
    label.setAttribute('text-anchor', 'start');
    label.setAttribute('x', String(after + 5));
    if (fits < full.length) {
      label.textContent = fits >= 2 ? full.slice(0, fits - 1).trimEnd() + '…' : '';
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = full;
      g.prepend(title);
    }
  }
  // End dates near the chart's right edge: widen the chart instead of cutting them off.
  const vb = svg.viewBox?.baseVal;
  if (maxRight && vb?.width && maxRight + 12 > vb.x + vb.width) {
    const width = Math.ceil(maxRight + 12 - vb.x);
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${width} ${vb.height}`);
    if (svg.hasAttribute('width') && !/%$/.test(svg.getAttribute('width'))) svg.setAttribute('width', String(width));
  }
  return insideLabels;
}
