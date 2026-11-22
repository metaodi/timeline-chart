/**
 * Generate sprint / Program Increment (PI) structures for agile timelines.
 *
 * Produces model sections (see model.js): one section per PI (or a single
 * section if no PI grouping is wanted), one period per sprint/iteration.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD" as a local-timezone-free UTC date. */
export function parseDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${iso}`);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date, style = 'short') {
  const opts =
    style === 'iso'
      ? null
      : style === 'long'
        ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (!opts) return date.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-GB', opts).format(date);
}

/**
 * @param {object} o
 * @param {string} o.startDate        first day of the first sprint (YYYY-MM-DD)
 * @param {number} o.sprintWeeks      length of a sprint in weeks
 * @param {number} o.sprintCount      total number of (development) sprints
 * @param {number} o.sprintsPerPI     sprints per PI; 0 = no PI grouping
 * @param {boolean} o.ipIteration     append an Innovation & Planning iteration to each PI
 * @param {number} o.firstSprint      number of the first sprint
 * @param {string} o.firstPI          number/name of the first PI ("1", "2026.1"); trailing number increments
 * @param {string} o.sprintPrefix     e.g. "Sprint" or "Iteration"
 * @param {string} o.piPrefix         e.g. "PI"
 * @param {string} o.dateStyle        'short' | 'long' | 'iso' | 'none'
 * @param {string} o.sectionName      section name when sprintsPerPI = 0
 * @returns {{ name: string, periods: {label: string, events: string[]}[] }[]}
 */
export function generateSprints(o) {
  const opt = {
    sprintWeeks: 2,
    sprintCount: 6,
    sprintsPerPI: 0,
    ipIteration: false,
    firstSprint: 1,
    firstPI: 1,
    sprintPrefix: 'Sprint',
    piPrefix: 'PI',
    dateStyle: 'short',
    sectionName: 'Sprints',
    ...o,
  };
  const weeks = Math.max(1, Number(opt.sprintWeeks) || 1);
  const count = Math.max(1, Math.min(200, Number(opt.sprintCount) || 1));
  const perPI = Math.max(0, Number(opt.sprintsPerPI) || 0);
  let cursor = parseDate(opt.startDate);

  const range = (start) => {
    const end = new Date(start.getTime() + (weeks * 7 - 1) * DAY);
    if (opt.dateStyle === 'none') return '';
    // weekdays only: a sprint starting on Monday ends on Friday
    const shownEnd = end.getUTCDay() === 0 ? new Date(end - 2 * DAY) : end;
    return `${formatDate(start, opt.dateStyle)} – ${formatDate(shownEnd, opt.dateStyle)}`;
  };
  const period = (label) => {
    const dates = range(cursor);
    cursor = new Date(cursor.getTime() + weeks * 7 * DAY);
    return { label: dates ? `${label}\n${dates}` : label, events: [] };
  };

  const sections = [];
  let sprintNo = Number(opt.firstSprint) || 1;
  if (perPI === 0) {
    const periods = [];
    for (let i = 0; i < count; i++) periods.push(period(`${opt.sprintPrefix} ${sprintNo++}`));
    sections.push({ name: opt.sectionName, periods });
    return sections;
  }

  let piName = String(opt.firstPI ?? '1').trim() || '1';
  let remaining = count;
  while (remaining > 0) {
    const piStart = cursor;
    const periods = [];
    const n = Math.min(perPI, remaining);
    for (let i = 0; i < n; i++) periods.push(period(`${opt.sprintPrefix} ${sprintNo++}`));
    remaining -= n;
    if (opt.ipIteration) periods.push({ ...period('IP Iteration'), events: ['Inspect & Adapt', '🏁 PI Planning'] });
    const piEnd = new Date(cursor.getTime() - 3 * DAY);
    const dates =
      opt.dateStyle === 'none' ? '' : `\n${formatDate(piStart, opt.dateStyle)} – ${formatDate(piEnd, opt.dateStyle)}`;
    sections.push({ name: `${opt.piPrefix} ${piName}${dates}`, periods });
    piName = nextName(piName);
  }
  return sections;
}

/** Increment the trailing number of a name: "3" -> "4", "2026.1" -> "2026.2", "A" -> "A 2". */
export function nextName(name) {
  const m = String(name).match(/^(.*?)(\d+)$/);
  if (!m) return `${name} 2`;
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
}
