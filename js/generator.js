/**
 * Sprint / Program Increment (PI) calendar.
 *
 * `sprintPlanFromConfig()` turns the calendar settings into PIs and sprints
 * (editable in Gantt mode), `calendarFromPlan()` adds the dates. Tasks in Gantt
 * mode reference sprints by id ("s1", "s2", …).
 */

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_CALENDAR = {
  startDate: '',
  sprintWeeks: 2,
  sprintCount: 8,
  sprintsPerPI: 4,
  ipIteration: true,
  restartNumbering: false, // sprint numbers start again in every PI
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
 * Sprint plan = PIs containing sprints, without dates. It is generated from the
 * calendar settings and can then be edited freely (names, lengths, order).
 * A PI with an empty name groups sprints that belong to no PI.
 *
 * @typedef {{ id: string, name: string, weeks: number }} PlanSprint
 * @typedef {{ id: string, name: string, sprints: PlanSprint[] }} PlanPI
 * @param {Partial<typeof DEFAULT_CALENDAR>} o
 * @returns {PlanPI[]}
 */
export function sprintPlanFromConfig(o) {
  const opt = { ...DEFAULT_CALENDAR, ...o };
  const weeks = Math.max(1, Math.min(12, Number(opt.sprintWeeks) || 1));
  const count = Math.max(1, Math.min(200, Number(opt.sprintCount) || 1));
  const perPI = Math.max(0, Number(opt.sprintsPerPI) || 0);
  let sprintNo = Number(opt.firstSprint) || 0;
  let sid = 0;
  const sprint = (name) => ({ id: `s${++sid}`, name, weeks });

  if (perPI === 0) {
    const sprints = [];
    for (let i = 0; i < count; i++) sprints.push(sprint(`${opt.sprintPrefix} ${sprintNo++}`));
    return [{ id: 'pi1', name: '', sprints }];
  }
  const pis = [];
  let piName = String(opt.firstPI ?? '1').trim() || '1';
  let remaining = count;
  while (remaining > 0) {
    const n = Math.min(perPI, remaining);
    if (opt.restartNumbering) sprintNo = Number(opt.firstSprint) || 0;
    const sprints = [];
    for (let i = 0; i < n; i++) sprints.push(sprint(`${opt.sprintPrefix} ${sprintNo++}`));
    if (opt.ipIteration) sprints.push(sprint('IP Iteration'));
    remaining -= n;
    pis.push({ id: `pi${pis.length + 1}`, name: `${opt.piPrefix} ${piName}`, sprints });
    piName = nextName(piName);
  }
  return pis;
}

const isIP = (name) => /^IP\b/i.test(String(name).trim());

/** Short label for the sprint row: "IP", the trailing number ("Sprint 12" -> "12") or the name. */
export function shortSprintLabel(name) {
  if (isIP(name)) return 'IP';
  const m = /(\d+)\s*$/.exec(String(name));
  return m ? m[1] : String(name).trim();
}

/**
 * Dates for a sprint plan: sprints follow each other from `startDate`.
 * @param {string} startDate YYYY-MM-DD
 * @param {PlanPI[]} plan
 * @returns {{
 *   sprints: { id: string, name: string, short: string, weeks: number, start: Date, end: Date, pi: number|null, ip: boolean }[],
 *   pis: { id: string, name: string, start: Date, end: Date }[],
 * }} `pi` is an index into `pis` (null for sprints without a PI); `end` is the last working day.
 */
export function calendarFromPlan(startDate, plan) {
  const sprints = [];
  const pis = [];
  let cursor = parseDate(startDate);
  for (const group of plan) {
    if (!group.sprints.length) continue;
    const named = String(group.name).trim() !== '';
    const index = named ? pis.length : null;
    const first = sprints.length;
    for (const sp of group.sprints) {
      const weeks = Math.max(1, Number(sp.weeks) || 1);
      const start = cursor;
      cursor = addDays(cursor, weeks * 7);
      sprints.push({ id: sp.id, name: sp.name, short: shortSprintLabel(sp.name), weeks, start, end: lastWeekday(addDays(cursor, -1)), pi: index, ip: isIP(sp.name) });
    }
    if (named) pis.push({ id: group.id, name: group.name, start: sprints[first].start, end: sprints[sprints.length - 1].end });
  }
  return { sprints, pis };
}

/** Calendar straight from the settings (used by the timeline generator). */
export function sprintCalendar(o) {
  return calendarFromPlan({ ...DEFAULT_CALENDAR, ...o }.startDate, sprintPlanFromConfig(o));
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
