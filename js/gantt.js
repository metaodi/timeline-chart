/**
 * Gantt mode: model, Mermaid serialisation and import.
 *
 * Model (state.gantt):
 * {
 *   calendar: { startDate, sprintWeeks, sprintCount, sprintsPerPI, ipIteration, restartNumbering, firstSprint, firstPI, sprintPrefix, piPrefix },
 *   pis: [{ id, name, sprints: [{ id, name, weeks }] }],  // generated from `calendar`, then editable
 *                                                         // (a PI with an empty name = sprints without PI)
 *   showPIs: boolean,          // a "PIs" row at the top of the chart
 *   showSprints: boolean,      // a "Sprints" row
 *   excludeWeekends: boolean,
 *   todayMarker: boolean,
 *   endDates: '' | 'all' | 'some', // end date (with a dot) after bars and milestones: none, all, chosen tasks
 *   endDateFormat: 'dmy' | 'iso',
 *   axisFormat: string,   // time axis labels (Mermaid axisFormat, strftime: "%m.%Y"); '' = "%d %b"
 *   tickInterval: string, // ticks + grid lines ("1month", "2week", "3day"); '' = one per sprint (or Pele's choice)
 *   minWidth: number,     // chart width range in px (Mermaid useWidth); 0 = automatic (1000 / 4000)
 *   maxWidth: number,     //   min = max: fixed width. A range also stops the preview from widening the chart.
 *   sections: [{ name, color, tasks: Task[] }],   // color: 0 = automatic, 1..8 = theme colour
 * }
 * Task = {
 *   id: string,          // stable id, used by "after:<id>"
 *   name: string,
 *   type: 'task' | 'milestone' | 'deadline',
 *   status: '' | 'done' | 'active' | 'crit',
 *   look: '' | 'hatch' | 'option',  // bars only: hatched (independent work package) / dashed outline (option)
 *   endDate: '' | 'show' | 'hide',  // per task: end date shown / hidden regardless of the chart's `endDates`
 *   from: Start,         // where a bar starts / where a milestone or deadline sits
 *   duration: string,    // "2s" sprints, "3w" weeks, "10d" working days; "" = until `to`
 *   to: Ref,             // end when no duration is given
 * }
 * Start = "prev"        after the previous task of the same section (default)
 *       | "plan"        at the plan start (calendar start date)
 *       | "after:<id>"  after another task
 *       | Ref
 * Ref   = "s3" (a sprint of the calendar) or "YYYY-MM-DD".
 *
 * Concrete dates are computed here (`scheduleGantt`), so the user only gives
 * durations and, at most, a start date for the whole plan. Changing the
 * calendar or a duration moves everything that follows.
 */
import { DEFAULT_CALENDAR, sprintPlanFromConfig, calendarFromPlan, parseDate, isoDate, addDays } from './generator.js';

export const TASK_TYPES = [
  { id: 'task', icon: '▬', label: 'Bar (spans time)' },
  { id: 'milestone', icon: '◆', label: 'Milestone' },
  { id: 'deadline', icon: '┃', label: 'Deadline (vertical line)' },
];

export const STATUSES = [
  { id: '', label: 'Planned' },
  { id: 'active', label: 'In progress' },
  { id: 'done', label: 'Done' },
  { id: 'crit', label: 'Critical' },
];

/** Bar looks that Mermaid can't express (kept in a comment, drawn by gantt-style.js). */
export const LOOKS = [
  { id: '', label: 'Solid' },
  { id: 'hatch', label: 'Hatched (independent)' },
  { id: 'option', label: 'Dashed (option)' },
];
/** Which entries show their end date (a dot after bars + the date, also next to milestones). */
export const END_DATE_MODES = [
  { id: '', label: 'No end dates' },
  { id: 'all', label: 'End dates on all entries' },
  { id: 'some', label: 'End dates on chosen entries (📅)' },
];
/** Formats of the end dates. */
export const END_DATE_FORMATS = [
  { id: 'dmy', label: '31.03.2027' },
  { id: 'iso', label: '2027-03-31' },
];

/** Whether a task shows its end date: the chart's setting, overridden per task ("show" / "hide"). */
export function showsEndDate(g, task) {
  if (!g?.endDates || !task || task.type === 'deadline') return false;
  return g.endDates === 'all' ? task.endDate !== 'hide' : task.endDate === 'show';
}
/** Default label format of the time axis. */
export const DEFAULT_AXIS_FORMAT = '%d %b';
/** Presets for the time axis: label format (Mermaid `axisFormat`, strftime) and tick interval ('' = automatic). */
export const AXIS_PRESETS = [
  { id: 'auto', label: 'Axis 05 Jan', format: '', tick: '' },
  { id: 'month', label: 'Axis by month 01.2027', format: '%m.%Y', tick: '1month' },
  { id: 'dmy', label: 'Axis 05.01.2027', format: '%d.%m.%Y', tick: '' },
];
/** Units of a custom tick interval (as Pele/Mermaid spell them). */
export const TICK_UNITS = ['day', 'week', 'month'];
const isTick = (t) => new RegExp(`^[1-9]\\d{0,2}(${TICK_UNITS.join('|')})$`).test(t ?? '');
/** An axis format the grammar can hold (no line breaks, "#" or ";"). */
export const cleanAxisFormat = (f) => String(f ?? '').replace(/[#;\r\n]/g, '').trim().slice(0, 40);
const LOOKS_KEY = 'task-looks';
const END_DATES_KEY = 'end-dates';
const WIDTH_KEY = 'chart-width';
/** Automatic chart width range and the limits a user may set (px). */
export const AUTO_WIDTH = { min: 1000, max: 4000 };
export const WIDTH_LIMITS = { min: 300, max: 8000, step: 50 }; // also the width slider's range
const cleanWidth = (w) => {
  const n = Math.round(Number(w));
  return Number.isFinite(n) && n > 0 ? Math.max(WIDTH_LIMITS.min, Math.min(WIDTH_LIMITS.max, n)) : 0;
};
/** `{ minWidth, maxWidth }` within the limits (0 = automatic), swapped if min > max. */
export function cleanWidthRange(min, max) {
  const [a, b] = [cleanWidth(min), cleanWidth(max)];
  return a && b && a > b ? { minWidth: b, maxWidth: a } : { minWidth: a, maxWidth: b };
}
const END_DATE_TASKS_KEY = 'end-date-tasks';
const CAL_KEY = 'sprint-calendar';
const PLAN_KEY = 'sprint-plan';
const COLOURS_KEY = 'section-colours';
const ROWS_KEY = 'row-colours';
const NOTES_KEY = 'notes';

/** Row stripe presets: [first row, second row] (see rowColour() in themes.js). */
export const ROW_PRESETS = {
  standard: { label: 'Standard', rows: ['surface', 'none'] },
  subtle: { label: 'Subtle grey', rows: ['surface', 'mix'] },
  plain: { label: 'No stripes', rows: ['none', 'none'] },
};
const isRowToken = (t) => ['none', 'surface', 'mix'].includes(t) || /^#[0-9a-f]{6}$/i.test(t ?? '');
const isSprintRef = (ref) => /^s\d+$/.test(ref ?? '');
const isDate = (ref) => /^\d{4}-\d{2}-\d{2}$/.test(ref ?? '');

export function emptyGantt() {
  return {
    calendar: { ...DEFAULT_CALENDAR, startDate: '' },
    showPIs: true,
    showSprints: true,
    rows: [...ROW_PRESETS.standard.rows], // zebra stripes of the chart rows
    showNotes: true, // numbered notes below the chart
    showLegend: true, // legend below the chart (only elements that occur)
    legendLabels: {}, // own legend texts, e.g. { "status-done": "Erledigt" }
    layout: 'compact', // 'compact' (packed by date) | 'ordered' (one row per entry, editor order)
    excludeWeekends: false, // kept for imported charts; no UI (clean look)
    todayMarker: false,
    endDates: '', // see END_DATE_MODES
    endDateFormat: 'dmy', // see END_DATE_FORMATS
    axisFormat: '', // '' = DEFAULT_AXIS_FORMAT
    tickInterval: '', // '' = automatic
    minWidth: 0, // chart width range in px; 0 = automatic
    maxWidth: 0,
    sections: [],
  };
}

export const DURATION_UNITS = [
  { id: 's', one: 'sprint', many: 'sprints' },
  { id: 'w', one: 'week', many: 'weeks' },
  { id: 'd', one: 'working day', many: 'working days' },
];

export const newId = () => 't' + Math.random().toString(36).slice(2, 8);

export function newTask(type = 'task', from = 'prev', duration = '1s') {
  return { id: newId(), name: '', type, status: '', from, duration: type === 'task' ? duration : '', to: '' };
}

export function newGanttSection(name = '', task = newTask('task', 'plan')) {
  return { name, color: 0, tasks: [task] };
}

export const SECTION_COLOURS = 8;
/** Colours for automatic assignment: all but no. 4 (red), which stands for "critical". */
const AUTO_COLOURS = [1, 2, 3, 5, 6, 7, 8];

/**
 * Theme colour (1..8) of a section: its chosen colour, or automatically one
 * per section (PIs and sprints are drawn in neutral black/grey).
 */
export function sectionColour(g, si) {
  const chosen = Number(g.sections[si]?.color) || 0;
  if (chosen >= 1 && chosen <= SECTION_COLOURS) return chosen;
  return AUTO_COLOURS[si % AUTO_COLOURS.length];
}

/** Next free id with a prefix ("s" for sprints, "pi" for PIs) within the sprint plan. */
function nextPlanId(pis, prefix) {
  const ids = prefix === 'pi' ? pis.map((p) => p.id) : pis.flatMap((p) => p.sprints.map((x) => x.id));
  const max = Math.max(0, ...ids.map((id) => Number(new RegExp(`^${prefix}(\\d+)$`).exec(id)?.[1] ?? 0)));
  return `${prefix}${max + 1}`;
}

export function newPlanSprint(pis, name = '', weeks = 2) {
  return { id: nextPlanId(pis, 's'), name, weeks };
}

export function newPlanPI(pis, name = '', weeks = 2) {
  return { id: nextPlanId(pis, 'pi'), name, sprints: [newPlanSprint(pis, '', weeks)] };
}

function normalizePlan(pis) {
  return pis.map((p, i) => ({
    id: typeof p?.id === 'string' && p.id ? p.id : `pi${i + 1}`,
    name: String(p?.name ?? ''),
    sprints: (Array.isArray(p?.sprints) ? p.sprints : []).map((x) => ({
      id: String(x?.id ?? ''),
      name: String(x?.name ?? ''),
      weeks: Math.max(1, Math.min(12, Math.round(Number(x?.weeks) || 2))),
    })),
  }));
}

export function normalizeGantt(g) {
  const base = emptyGantt();
  const d = { ...base, ...(g || {}) };
  d.calendar = { ...DEFAULT_CALENDAR, ...(d.calendar || {}) };
  for (const k of ['showPIs', 'showSprints', 'excludeWeekends', 'todayMarker']) d[k] = Boolean(d[k]);
  d.showNotes = d.showNotes !== false;
  d.showLegend = d.showLegend !== false;
  // own legend texts per entry kind (see LEGEND_DEFAULTS in gantt-legend.js); empty = default
  d.legendLabels = Object.fromEntries(
    Object.entries(d.legendLabels && typeof d.legendLabels === 'object' ? d.legendLabels : {})
      .filter(([k, v]) => /^[a-z-]+$/.test(k) && typeof v === 'string' && v.trim())
      .map(([k, v]) => [k, v.slice(0, 80)]),
  );
  d.layout = d.layout === 'ordered' ? 'ordered' : 'compact';
  // (first version: endDates was the format, meaning "all")
  if (END_DATE_FORMATS.some((f) => f.id === d.endDates)) [d.endDateFormat, d.endDates] = [d.endDates, 'all'];
  d.endDates = END_DATE_MODES.some((f) => f.id === d.endDates) ? d.endDates : '';
  d.endDateFormat = END_DATE_FORMATS.some((f) => f.id === d.endDateFormat) ? d.endDateFormat : 'dmy';
  d.axisFormat = cleanAxisFormat(d.axisFormat);
  if (d.axisFormat === DEFAULT_AXIS_FORMAT) d.axisFormat = '';
  d.tickInterval = isTick(d.tickInterval) ? d.tickInterval : '';
  Object.assign(d, cleanWidthRange(d.minWidth, d.maxWidth));
  d.rows = [0, 1].map((i) => (isRowToken(d.rows?.[i]) ? d.rows[i].toLowerCase() : ROW_PRESETS.standard.rows[i]));
  d.pis = Array.isArray(d.pis) ? normalizePlan(d.pis) : sprintPlanFromConfig(d.calendar);
  // every sprint needs a unique id (tasks reference them)
  const seen = new Set();
  for (const p of d.pis) for (const x of p.sprints) {
    if (!/^s\d+$/.test(x.id) || seen.has(x.id)) x.id = nextPlanId(d.pis, 's');
    seen.add(x.id);
  }
  const types = TASK_TYPES.map((t) => t.id);
  const statuses = STATUSES.map((s) => s.id);
  const looks = LOOKS.map((l) => l.id);
  d.sections = Array.isArray(d.sections)
    ? d.sections.map((s) => ({
        name: String(s?.name ?? ''),
        color: Math.max(0, Math.min(SECTION_COLOURS, Math.round(Number(s?.color) || 0))),
        tasks: Array.isArray(s?.tasks)
          ? s.tasks.map((t) => ({
              id: typeof t?.id === 'string' && t.id ? t.id : newId(),
              name: String(t?.name ?? ''),
              type: types.includes(t?.type) ? t.type : 'task',
              status: statuses.includes(t?.status) ? t.status : '',
              look: looks.includes(t?.look) ? t.look : '',
              endDate: ['show', 'hide'].includes(t?.endDate) ? t.endDate : '',
              from: String(t?.from || 'prev'),
              duration: /^\d+[swd]$/.test(t?.duration ?? '') ? t.duration : '',
              note: String(t?.note ?? ''), // details: tooltip + footnote (gantt-notes.js)
              link: String(t?.link ?? '').trim(), // URL: the entry becomes a link (Mermaid "click … href")
              to: String(t?.to ?? ''),
            }))
          : [],
      }))
    : [];
  return d;
}

/** Sprint and PI dates of a gantt model, or an empty calendar if no start date is set. */
export function calendarOf(g) {
  if (!isDate(g.calendar?.startDate)) return { sprints: [], pis: [] };
  try {
    return calendarFromPlan(g.calendar.startDate, Array.isArray(g.pis) ? g.pis : sprintPlanFromConfig(g.calendar));
  } catch {
    return { sprints: [], pis: [] };
  }
}

// ---------------------------------------------------------------------------
// Scheduling: turn starts + durations into concrete dates
// ---------------------------------------------------------------------------

const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
/** The date itself, or the following Monday if it falls on a weekend. */
export const workday = (d) => (isWeekend(d) ? workday(addDays(d, 1)) : d);
const nextWorkday = (d) => workday(addDays(d, 1));
const lastWorkday = (d) => (isWeekend(d) ? lastWorkday(addDays(d, -1)) : d);

/** Inclusive end of a task starting on `start` lasting `duration` ("2s", "3w", "10d"). */
export function endFor(start, duration, g, cal) {
  const m = /^(\d+)([swd])$/.exec(duration);
  if (!m) return null;
  const n = Math.max(1, Number(m[1]));
  if (m[2] === 'd') {
    let d = workday(start);
    for (let i = 1; i < n; i++) d = nextWorkday(d);
    return d;
  }
  if (m[2] === 's') {
    // Aligned with a sprint start: end with the n-th sprint (IP iterations count as sprints).
    const i = cal.sprints.findIndex((sp) => sp.start.getTime() === start.getTime());
    if (i >= 0 && cal.sprints[i + n - 1]) return cal.sprints[i + n - 1].end;
    return lastWorkday(addDays(start, n * 7 * (Number(g.calendar.sprintWeeks) || 2) - 1));
  }
  return lastWorkday(addDays(start, n * 7 - 1));
}

/**
 * Compute start/end dates of every task.
 * @returns {{ cal, planStart: Date|null, dates: ({start: Date, end: Date}|null)[][] }}
 *   dates[section][task]; null when a task cannot be placed (e.g. no plan start).
 */
export function scheduleGantt(gantt) {
  const g = normalizeGanttShallow(gantt);
  const cal = calendarOf(g);
  const planStart = isDate(g.calendar.startDate) ? workday(parseDate(g.calendar.startDate)) : null;
  const where = new Map(); // id -> [si, ti]
  g.sections.forEach((s, si) => s.tasks.forEach((t, ti) => where.set(t.id, [si, ti])));
  const dates = g.sections.map((s) => s.tasks.map(() => undefined));
  const visiting = new Set();

  const place = (si, ti) => {
    if (dates[si][ti] !== undefined) return dates[si][ti];
    const t = g.sections[si].tasks[ti];
    if (visiting.has(t.id)) return null; // circular "after" chain
    visiting.add(t.id);
    const point = t.type !== 'task';
    const endOf = (pos) => (pos ? place(...pos)?.end ?? null : null);
    let start = null;
    const f = t.from;
    if (f === 'prev') {
      const prevEnd = ti > 0 ? endOf([si, ti - 1]) : null;
      start = ti > 0 ? (prevEnd && (point ? prevEnd : nextWorkday(prevEnd))) : planStart;
    } else if (f === 'plan') {
      start = planStart;
    } else if (f.startsWith('after:')) {
      const e = endOf(where.get(f.slice(6)));
      start = e && (point ? e : nextWorkday(e));
    } else {
      start = resolveRef(f, point ? 'end' : 'start', cal);
      if (start && !point) start = workday(start);
    }
    let result = null;
    if (start && point) {
      result = { start, end: start };
    } else if (start) {
      let end = t.duration ? endFor(start, t.duration, g, cal) : resolveRef(t.to, 'end', cal);
      if (end && end < start) end = start;
      result = end ? { start, end } : null;
    }
    visiting.delete(t.id);
    dates[si][ti] = result;
    return result;
  };
  g.sections.forEach((s, si) => s.tasks.forEach((_, ti) => place(si, ti)));
  return { cal, planStart, dates };
}

/** normalizeGantt without regenerating ids (scheduling must see the caller's ids). */
function normalizeGanttShallow(g) {
  return g?.calendar && Array.isArray(g.sections) ? g : normalizeGantt(g);
}

/** Resolve a Ref to a Date. `edge` = 'start' | 'end' picks the sprint's first or last day. */
export function resolveRef(ref, edge, cal) {
  if (isDate(ref)) return parseDate(ref);
  if (isSprintRef(ref)) {
    const s = cal.sprints.find((x) => x.id === ref);
    return s ? s[edge] : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Gantt task/section names cannot contain ":" and task data cannot contain "#" or ";". */
export function escapeGanttText(text) {
  return String(text)
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim()
    .replace(/[#:;]/g, (c) => `#${c.codePointAt(0)};`); // one pass: entities contain "#" and ";"
}

function calendarComment(c) {
  const parts = [
    `start=${c.startDate}`,
    `weeks=${c.sprintWeeks}`,
    `count=${c.sprintCount}`,
    `perPI=${c.sprintsPerPI}`,
    `ip=${c.ipIteration ? 1 : 0}`,
    `restart=${c.restartNumbering ? 1 : 0}`,
    `firstSprint=${c.firstSprint}`,
    `firstPI=${encodeURIComponent(c.firstPI)}`,
    `sprint=${encodeURIComponent(c.sprintPrefix)}`,
    `pi=${encodeURIComponent(c.piPrefix)}`,
  ];
  return `  %% ${CAL_KEY} ${parts.join(' ')}`;
}

/**
 * One task line from scheduled dates, or null if the task could not be placed.
 * `id` (e.g. "g0t2") lets gantt-style.js colour the bar by its section.
 */
export function taskLine(task, when, id = '', span = 0) {
  if (!when) return null;
  const name = escapeGanttText(task.name) || '&nbsp;';
  const tags = [];
  if (task.type === 'milestone') tags.push('milestone');
  if (task.type === 'deadline') tags.push('vert');
  if (task.status) tags.push(task.status);
  let dates;
  if (task.type === 'task') dates = [isoDate(when.start), isoDate(when.end)];
  else if (task.type === 'milestone' && span > 0)
    // A range centred on the date (Pele draws the diamond in its middle): in the compact
    // layout the milestone and its label then get their own row instead of overlapping.
    dates = [isoDate(addDays(when.start, -span)), isoDate(addDays(when.start, span - 1))];
  else dates = [isoDate(when.start), '0d'];
  return `    ${name} : ${[...tags, id, ...dates].filter(Boolean).join(', ')}`;
}

/** Days a milestone's diamond and label take up on each side of its date. */
export function milestoneSpan(name, pxPerDay) {
  const px = String(name).trim().length * 7.5 + 40; // label (≈13px font) + diamond + gap
  return Math.max(1, Math.min(90, Math.ceil(px / Math.max(pxPerDay, 0.1))));
}
/**
 * The chart's width range in px: the user's min / max (`g.minWidth`, `g.maxWidth`),
 * else 1000 – 4000. `custom`: the user set at least one bound.
 */
export function widthRange(g) {
  const min = cleanWidth(g?.minWidth);
  const max = cleanWidth(g?.maxWidth);
  const hi = max || Math.max(AUTO_WIDTH.max, min);
  const lo = Math.min(min || AUTO_WIDTH.min, hi);
  return { min: lo, max: hi, custom: Boolean(min || max) };
}

/** Text next to the width slider: "Auto · 1000 – 4000 px", "1200 – 2000 px", "1600 px fixed". */
export function widthLabel(g) {
  const { min, max, custom } = widthRange(g);
  if (!custom) return `Auto · ${min} – ${max} px`;
  return min === max ? `${min} px fixed` : `${min} – ${max} px`;
}

/**
 * Chart width (Mermaid `useWidth`): about 40px per week, so long plans get wider
 * instead of cramped. Within `widthRange(g)` (default 1000 – 4000px).
 */
export function ganttWidth(cal, dates, g) {
  return ganttScale(cal, dates, g).width;
}

/** Chart width and its approximate scale (pixels per day on the time axis). */
export function ganttScale(cal, dates, g) {
  const range = widthRange(g);
  const all = [...cal.sprints, ...dates.flat().filter(Boolean)];
  if (!all.length) return { width: Math.max(range.min, Math.min(range.max, 1000)), pxPerDay: 10 };
  const start = Math.min(...all.map((d) => d.start.getTime()));
  const end = Math.max(...all.map((d) => d.end.getTime()));
  const days = (end - start) / 864e5 + 1;
  const width = Math.max(range.min, Math.min(range.max, Math.round((260 + (days / 7) * 40) / 10) * 10));
  // ~180px for section names and padding; start/end bound the time axis
  return { width, pxPerDay: (width - 180) / days, start, end };
}

export function toGanttMermaid(t, frontmatter = []) {
  const g = normalizeGanttShallow(t.gantt);
  const { cal, dates } = scheduleGantt(g);
  const fm = [...frontmatter];
  const at = fm.indexOf('  gantt:');
  const compact = g.layout !== 'ordered';
  const scale = ganttScale(cal, dates, g);
  if (at >= 0) fm.splice(at + (compact ? 2 : 1), 0, `    useWidth: ${scale.width}`);
  const out = [...fm, 'gantt'];
  if (t.title?.trim()) out.push(`  title ${t.title.replace(/\s*\n\s*/g, ' ').trim()}`);
  if (t.accTitle?.trim()) out.push(`  accTitle: ${t.accTitle.trim()}`);
  if (t.accDescr?.trim()) out.push(`  accDescr: ${t.accDescr.replace(/\s*\n\s*/g, ' ').trim()}`);
  out.push('  dateFormat YYYY-MM-DD', `  axisFormat ${cleanAxisFormat(g.axisFormat) || DEFAULT_AXIS_FORMAT}`);
  // ticks (and grid lines): as chosen, or one per sprint
  const tick = isTick(g.tickInterval) ? g.tickInterval : cal.sprints.length ? `${g.calendar.sprintWeeks}week` : '';
  if (tick) out.push(`  tickInterval ${tick}`);
  if (tick.endsWith('week')) out.push('  weekday monday');
  if (g.excludeWeekends) out.push('  excludes weekends');
  out.push('  inclusiveEndDates');
  if (!g.todayMarker) out.push('  todayMarker off');
  if (cal.sprints.length) {
    out.push(calendarComment(g.calendar));
    // The edited sprint plan, so that importing the code restores it exactly.
    const plan = (g.pis ?? []).map((p) => ({ id: p.id, name: p.name, sprints: p.sprints.map((x) => [x.id, x.name, x.weeks]) }));
    out.push(`  %% ${PLAN_KEY} ${JSON.stringify(plan)}`);
    if (g.showPIs && cal.pis.length) {
      out.push(`  section ${escapeGanttText(plural(g.calendar.piPrefix || 'PI'))}`);
      for (const pi of cal.pis) out.push(`    ${escapeGanttText(pi.name)} : ${pi.id}, ${isoDate(pi.start)}, ${isoDate(pi.end)}`);
    }
    if (g.showSprints) {
      out.push(`  section ${escapeGanttText(plural(g.calendar.sprintPrefix || 'Sprint'))}`);
      // Short labels ("1", "2", "IP") fit inside the bars when sprints sit side by side.
      for (const s of cal.sprints) out.push(`    ${escapeGanttText(s.short)} : ${s.id}, ${isoDate(s.start)}, ${isoDate(s.end)}`);
    }
  }
  if (g.sections.some((s) => s.color)) out.push(`  %% ${COLOURS_KEY} ${g.sections.map((s) => s.color || 0).join(',')}`);
  const rows = g.rows ?? ROW_PRESETS.standard.rows;
  if (rows.join() !== ROW_PRESETS.standard.rows.join()) out.push(`  %% ${ROWS_KEY} ${rows.join(',')}`);
  // notes are not part of Mermaid: kept as a comment ({"g0t1": "…"}) so importing restores them
  const notes = {};
  g.sections.forEach((s, si) => s.tasks.forEach((t, ti) => t.note?.trim() && (notes[`g${si}t${ti}`] = t.note.trim())));
  if (Object.keys(notes).length) out.push(`  %% ${NOTES_KEY} ${JSON.stringify(notes)}${g.showNotes === false ? ' hidden' : ''}`);
  // hatched / dashed bars ({"g0t1": "hatch"}) and end dates: drawn by this app only
  const looks = {};
  g.sections.forEach((s, si) => s.tasks.forEach((t, ti) => t.look && t.type === 'task' && (looks[`g${si}t${ti}`] = t.look)));
  if (Object.keys(looks).length) out.push(`  %% ${LOOKS_KEY} ${JSON.stringify(looks)}`);
  const { minWidth, maxWidth } = cleanWidthRange(g.minWidth, g.maxWidth);
  if (minWidth || maxWidth) out.push(`  %% ${WIDTH_KEY} ${minWidth || 'auto'} ${maxWidth || 'auto'}`);
  if (g.endDates) out.push(`  %% ${END_DATES_KEY} ${g.endDates} ${g.endDateFormat || 'dmy'}`);
  const endDateTasks = {};
  g.sections.forEach((s, si) => s.tasks.forEach((t, ti) => ['show', 'hide'].includes(t.endDate) && t.type !== 'deadline' && (endDateTasks[`g${si}t${ti}`] = t.endDate)));
  if (Object.keys(endDateTasks).length) out.push(`  %% ${END_DATE_TASKS_KEY} ${JSON.stringify(endDateTasks)}`);
  g.sections.forEach((s, si) => {
    const lines = s.tasks
      .map((task, ti) => {
        const when = dates[si][ti];
        let span = 0;
        // (only needed in the compact layout; in the ordered one every entry has its own row)
        if (task.type === 'milestone' && when && compact) {
          // keep the range inside the chart, or Pele would stretch the time axis
          const d = when.start.getTime();
          const room = Math.min((d - scale.start) / 864e5, (scale.end - d) / 864e5 + 1);
          // (with end dates the label also holds the date)
          const label = showsEndDate(g, task) ? `${task.name} 00.00.0000` : task.name;
          span = Math.min(milestoneSpan(label, scale.pxPerDay), Math.floor(room));
        }
        return taskLine(task, when, `g${si}t${ti}`, span);
      })
      .filter(Boolean);
    out.push(`  section ${escapeGanttText(s.name) || '&nbsp;'}`, ...lines);
  });
  // links: standard Mermaid, so they also work in other Mermaid tools
  g.sections.forEach((s, si) =>
    s.tasks.forEach((t, ti) => {
      if (t.link?.trim() && dates[si][ti]) out.push(`  click g${si}t${ti} href "${t.link.trim().replace(/"/g, '%22')}"`);
    }),
  );
  return out.join('\n') + '\n';
}

export function isGanttEmpty(g) {
  return !scheduleGantt(g).dates.some((row) => row.some(Boolean));
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const unescape = (s) =>
  String(s)
    .replace(/#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
    .replace(/&nbsp;/g, ' ')
    .trim();

function readCalendarComment(line) {
  const cal = { ...DEFAULT_CALENDAR };
  for (const [, k, v] of line.matchAll(/(\w+)=(\S*)/g)) {
    const val = decodeURIComponent(v);
    if (k === 'start') cal.startDate = val;
    else if (k === 'weeks') cal.sprintWeeks = Number(val);
    else if (k === 'count') cal.sprintCount = Number(val);
    else if (k === 'perPI') cal.sprintsPerPI = Number(val);
    else if (k === 'ip') cal.ipIteration = val === '1';
    else if (k === 'restart') cal.restartNumbering = val === '1';
    else if (k === 'firstSprint') cal.firstSprint = Number(val);
    else if (k === 'firstPI') cal.firstPI = val;
    else if (k === 'sprint') cal.sprintPrefix = val;
    else if (k === 'pi') cal.piPrefix = val;
  }
  return cal;
}

/** Add a duration such as "3d", "2w" to a date (calendar days; inclusive end). */
function addDuration(start, dur) {
  const m = String(dur).match(/^(\d+(?:\.\d+)?)\s*([dw])$/);
  if (!m) return null;
  const days = Number(m[1]) * (m[2] === 'w' ? 7 : 1);
  return addDays(start, Math.max(0, Math.round(days) - 1));
}

/**
 * Parse Mermaid gantt code into the gantt model. Dates that match the sprint
 * calendar (written by this app as a comment) become sprint references again.
 * @returns {{ gantt: object, title: string, accTitle: string, accDescr: string, warnings: string[] }}
 */
export function parseGanttMermaid(code) {
  const g = emptyGantt();
  g.todayMarker = true;
  g.excludeWeekends = false;
  g.showPIs = false;
  g.showSprints = false;
  const res = { gantt: g, title: '', accTitle: '', accDescr: '', warnings: [] };
  const byId = new Map();
  let section = null;
  let generated = null; // 'pis' | 'sprints' while inside a generated calendar row
  let prevEnd = null;
  let seenHeader = false;
  let colours = [];
  let notes = {};
  let looks = {};
  let endDateTasks = {};
  const links = {};

  String(code)
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('%%')) {
        if (line.includes(CAL_KEY)) g.calendar = readCalendarComment(line);
        else if (line.startsWith(`%% ${NOTES_KEY} `)) {
          const body = line.slice(`%% ${NOTES_KEY} `.length).trim();
          try {
            notes = JSON.parse(body.replace(/\s+hidden$/, ''));
            if (/\s+hidden$/.test(body)) g.showNotes = false;
          } catch {
            res.warnings.push(`Line ${i + 1}: could not read the notes`);
          }
        } else if (line.startsWith(`%% ${LOOKS_KEY} `)) {
          try {
            looks = JSON.parse(line.slice(`%% ${LOOKS_KEY} `.length));
          } catch {
            res.warnings.push(`Line ${i + 1}: could not read the bar looks`);
          }
        } else if (line.startsWith(`%% ${END_DATE_TASKS_KEY} `)) {
          try {
            endDateTasks = JSON.parse(line.slice(`%% ${END_DATE_TASKS_KEY} `.length));
          } catch {
            res.warnings.push(`Line ${i + 1}: could not read the end dates of the tasks`);
          }
        } else if (line.startsWith(`%% ${WIDTH_KEY} `)) {
          const [min, max] = line.slice(`%% ${WIDTH_KEY} `.length).trim().split(/\s+/);
          Object.assign(g, cleanWidthRange(min, max));
        } else if (line.startsWith(`%% ${END_DATES_KEY} `)) {
          for (const w of line.slice(`%% ${END_DATES_KEY} `.length).trim().split(/\s+/)) {
            if (END_DATE_MODES.some((x) => x.id && x.id === w)) g.endDates = w;
            else if (END_DATE_FORMATS.some((x) => x.id === w)) {
              g.endDateFormat = w;
              if (!g.endDates) g.endDates = 'all'; // "%% end-dates dmy" (first version)
            }
          }
        } else if (line.includes(ROWS_KEY)) {
          const rows = line.slice(line.indexOf(ROWS_KEY) + ROWS_KEY.length).split(',').map((x) => x.trim());
          if (rows.length === 2 && rows.every(isRowToken)) g.rows = rows;
        } else if (line.includes(COLOURS_KEY)) {
          colours = line.slice(line.indexOf(COLOURS_KEY) + COLOURS_KEY.length).split(',').map((x) => Number(x.trim()) || 0);
        } else if (line.includes(PLAN_KEY)) {
          try {
            const plan = JSON.parse(line.slice(line.indexOf(PLAN_KEY) + PLAN_KEY.length));
            g.pis = normalizePlan(plan.map((p) => ({ ...p, sprints: p.sprints.map(([id, name, weeks]) => ({ id, name, weeks })) })));
          } catch {
            res.warnings.push(`Line ${i + 1}: could not read the sprint plan`);
          }
        }
        return;
      }
      if (!seenHeader) {
        if (/^gantt\b/i.test(line)) seenHeader = true;
        else res.warnings.push(`Line ${i + 1}: expected "gantt"`);
        return;
      }
      let m;
      if ((m = line.match(/^title\s+(.+)$/i))) res.title = m[1].trim();
      else if ((m = line.match(/^accTitle\s*:\s*(.*)$/))) res.accTitle = m[1].trim();
      else if ((m = line.match(/^accDescr\s*:\s*(.*)$/))) res.accDescr = m[1].trim();
      else if ((m = line.match(/^dateFormat\s+(.+)$/i))) {
        if (m[1].trim() !== 'YYYY-MM-DD') res.warnings.push(`Line ${i + 1}: only dateFormat YYYY-MM-DD is supported`);
      } else if (/^excludes\s+.*weekends/i.test(line)) g.excludeWeekends = true;
      else if (/^todayMarker\s+off/i.test(line)) g.todayMarker = false;
      else if ((m = line.match(/^axisFormat\s+(.+)$/i))) g.axisFormat = cleanAxisFormat(m[1]) === DEFAULT_AXIS_FORMAT ? '' : cleanAxisFormat(m[1]);
      else if ((m = line.match(/^tickInterval\s+(\S+)/i))) g.tickInterval = isTick(m[1]) ? m[1] : '';
      else if ((m = line.match(/^click\s+(\S+)\s+href\s+"([^"]*)"/i))) {
        for (const id of m[1].split(',')) links[id.trim()] = m[2];
      } else if (/^(axisFormat|tickInterval|weekday|weekend|inclusiveEndDates|includes|excludes|topAxis|displayMode|click|classDef|class)\b/i.test(line)) {
        /* layout options this app sets itself */
      } else if ((m = line.match(/^section\s+(.*)$/i))) {
        section = { name: unescape(m[1]), tasks: [] };
        generated = null;
        g.sections.push(section);
      } else if ((m = line.match(/^([^:]+):(.*)$/))) {
        const name = unescape(m[1]);
        const parts = m[2].split(',').map((p) => p.trim()).filter(Boolean);
        const task = { id: newId(), name, type: 'task', status: '', from: '', duration: '', to: '' };
        while (parts.length && /^(done|active|crit|milestone|vert)$/.test(parts[0])) {
          const tag = parts.shift();
          if (tag === 'milestone') task.type = 'milestone';
          else if (tag === 'vert') task.type = 'deadline';
          else if (!task.status || tag === 'crit') task.status = tag;
        }
        let id = null;
        if (parts.length === 3) id = parts.shift();
        let start = null;
        let endStr;
        if (parts.length === 2) {
          const s = parts[0];
          const after = s.match(/^after\s+(.+)$/);
          start = after
            ? after[1].split(/\s+/).map((x) => byId.get(x)).filter(Boolean).reduce((a, b) => (a > b ? a : b), null)
            : isDate(s) ? parseDate(s) : null;
          if (after && start) start = addDays(start, 1);
          endStr = parts[1];
        } else {
          start = prevEnd ? addDays(prevEnd, 1) : null;
          endStr = parts[0];
        }
        let end = isDate(endStr) ? parseDate(endStr) : start ? addDuration(start, endStr) : null;
        if (task.type !== 'task' && start) {
          // milestone written as a range (see taskLine): its date is the middle
          if (end && end > start) start = addDays(start, Math.floor(((end - start) / 864e5 + 1) / 2));
          end = start;
        }
        if (!end) {
          res.warnings.push(`Line ${i + 1}: could not read the dates of "${name}"`);
          return;
        }
        if (!start) start = end;
        if (id) byId.set(id, end);
        prevEnd = end;
        // Rows generated from the sprint calendar are rebuilt, not imported.
        if (id && /^(s|pi)\d+$/.test(id) && isDate(g.calendar.startDate) && section && section.tasks.length === 0 && !generated) {
          generated = id.startsWith('pi') ? 'pis' : 'sprints';
          g.sections.pop();
          if (generated === 'pis') g.showPIs = true;
          else g.showSprints = true;
        }
        if (generated) return;
        task.from = isoDate(task.type === 'task' ? start : end);
        task.to = task.type === 'task' ? isoDate(end) : '';
        if (!section) {
          section = { name: '', tasks: [] };
          g.sections.push(section);
        }
        section.tasks.push(task);
      } else {
        res.warnings.push(`Line ${i + 1}: not understood: "${line}"`);
      }
    });

  g.sections.forEach((sec, i) => (sec.color = colours[i] || 0));
  g.sections.forEach((sec, si) =>
    sec.tasks.forEach((t, ti) => {
      t.note = String(notes[`g${si}t${ti}`] ?? '');
      t.link = String(links[`g${si}t${ti}`] ?? '');
      t.look = t.type === 'task' && LOOKS.some((l) => l.id && l.id === looks[`g${si}t${ti}`]) ? looks[`g${si}t${ti}`] : '';
      t.endDate = ['show', 'hide'].includes(endDateTasks[`g${si}t${ti}`]) ? endDateTasks[`g${si}t${ti}`] : '';
    }),
  );
  snapToSprints(g);
  // the app writes one tick per sprint by itself: keep that automatic (follows the sprint length)
  if (calendarOf(g).sprints.length && g.tickInterval === `${g.calendar.sprintWeeks}week`) g.tickInterval = '';
  if (!seenHeader) res.warnings.unshift('No "gantt" header found');
  return res;
}

/**
 * Row label for the PI / sprint row: the prefix in the plural ("Sprints", "PIs").
 * German prefixes get their German plural ("Schritt" -> "Schritte", "Phase" -> "Phasen").
 */
const GERMAN_PLURALS = { schritt: 'Schritte', phase: 'Phasen', arbeitspaket: 'Arbeitspakete', etappe: 'Etappen' };
export function plural(word) {
  const w = String(word).trim();
  const german = GERMAN_PLURALS[w.toLowerCase()];
  if (german) return w[0] === w[0].toLowerCase() ? german.toLowerCase() : german;
  return /s$/i.test(w) ? w : `${w}s`;
}

/** End date as drawn after a bar or milestone ("31.03.2027" or "2027-03-31"). */
export function formatEndDate(date, format) {
  if (!date || !format) return '';
  const iso = isoDate(date);
  if (format === 'iso') return iso;
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Replace dates that fall exactly on sprint boundaries with sprint references. */
export function snapToSprints(g) {
  if (!Array.isArray(g.pis)) g.pis = sprintPlanFromConfig(g.calendar);
  const cal = calendarOf(g);
  if (!cal.sprints.length) return g;
  const byStart = new Map(cal.sprints.map((s) => [isoDate(s.start), s.id]));
  const byEnd = new Map(cal.sprints.map((s) => [isoDate(s.end), s.id]));
  for (const s of g.sections) {
    for (const t of s.tasks) {
      if (t.type === 'task') {
        if (byStart.has(t.from)) t.from = byStart.get(t.from);
        if (byEnd.has(t.to)) t.to = byEnd.get(t.to);
      } else if (byEnd.has(t.from)) {
        t.from = byEnd.get(t.from);
      }
    }
  }
  return g;
}
