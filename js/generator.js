/**
 * Sprint / Program Increment (PI) calendar.
 *
 * `sprintCalendar()` computes the dates of every sprint (and IP iteration) and
 * PI. It is used by the timeline generator (`generateSprints`) and by Gantt
 * mode, where tasks reference sprints by id ("s1", "s2", …).
 */

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_CALENDAR = {
  startDate: '',
  sprintWeeks: 2,
  sprintCount: 8,
  sprintsPerPI: 4,
  ipIteration: true,
  firstSprint: 1,
  firstPI: '1',
  sprintPrefix: 'Sprint',
  piPrefix: 'PI',
};

/** Parse "YYYY-MM-DD" as a UTC date (no timezone surprises). */
export function parseDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${iso}`);
  return new Date(Date.UTC(y, m - 1, d));
}

export const isoDate = (date) => date.toISOString().slice(0, 10);
export const addDays = (date, n) => new Date(date.getTime() + n * DAY);

export function formatDate(date, style = 'short') {
  if (style === 'iso') return isoDate(date);
  const opts =
    style === 'long'
      ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-GB', opts).format(date);
}

/** Last working day on or before `date` (a sprint starting Monday ends Friday). */
function lastWeekday(date) {
  const day = date.getUTCDay();
  return day === 0 ? addDays(date, -2) : day === 6 ? addDays(date, -1) : date;
}

/** Increment the trailing number of a name: "3" -> "4", "2026.1" -> "2026.2", "A" -> "A 2". */
export function nextName(name) {
  const m = String(name).match(/^(.*?)(\d+)$/);
  if (!m) return `${name} 2`;
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
}

/**
 * @param {Partial<typeof DEFAULT_CALENDAR>} o
 * @returns {{
 *   sprints: { id: string, name: string, short: string, start: Date, end: Date, pi: number|null, ip: boolean }[],
 *   pis: { id: string, name: string, start: Date, end: Date }[],
 * }} `end` is the last working day (inclusive).
 */
export function sprintCalendar(o) {
  const opt = { ...DEFAULT_CALENDAR, ...o };
  const weeks = Math.max(1, Math.min(12, Number(opt.sprintWeeks) || 1));
  const count = Math.max(1, Math.min(200, Number(opt.sprintCount) || 1));
  const perPI = Math.max(0, Number(opt.sprintsPerPI) || 0);
  const sprints = [];
  const pis = [];
  let cursor = parseDate(opt.startDate);
  let sprintNo = Number(opt.firstSprint) || 0;
  let piName = String(opt.firstPI ?? '1').trim() || '1';

  const iteration = (name, pi, ip) => {
    const start = cursor;
    cursor = addDays(cursor, weeks * 7);
    const short = ip ? 'IP' : String(sprintNo - 1);
    const s = { id: `s${sprints.length + 1}`, name, short, start, end: lastWeekday(addDays(cursor, -1)), pi, ip };
    sprints.push(s);
    return s;
  };

  if (perPI === 0) {
    for (let i = 0; i < count; i++) iteration(`${opt.sprintPrefix} ${sprintNo++}`, null, false);
    return { sprints, pis };
  }

  let remaining = count;
  while (remaining > 0) {
    const index = pis.length;
    const first = sprints.length;
    const n = Math.min(perPI, remaining);
    for (let i = 0; i < n; i++) iteration(`${opt.sprintPrefix} ${sprintNo++}`, index, false);
    remaining -= n;
    if (opt.ipIteration) iteration('IP Iteration', index, true);
    pis.push({
      id: `pi${index + 1}`,
      name: `${opt.piPrefix} ${piName}`,
      start: sprints[first].start,
      end: sprints[sprints.length - 1].end,
    });
    piName = nextName(piName);
  }
  return { sprints, pis };
}

/**
 * Timeline sections for the "Sprints / PIs" generator: one section per PI
 * (or a single section without PIs), one period per sprint.
 * @param {object} o calendar options plus `dateStyle` ('short'|'long'|'iso'|'none') and `sectionName`
 */
export function generateSprints(o) {
  const dateStyle = o.dateStyle ?? 'short';
  const cal = sprintCalendar(o);
  const range = (a, b) => (dateStyle === 'none' ? '' : `\n${formatDate(a, dateStyle)} – ${formatDate(b, dateStyle)}`);
  const period = (s) => ({
    label: s.name + range(s.start, s.end),
    events: s.ip ? ['Inspect & Adapt', '🏁 PI Planning'] : [],
  });
  if (!cal.pis.length) {
    return [{ name: o.sectionName ?? 'Sprints', periods: cal.sprints.map(period) }];
  }
  return cal.pis.map((pi, i) => ({
    name: pi.name + range(pi.start, pi.end),
    periods: cal.sprints.filter((s) => s.pi === i).map(period),
  }));
}
