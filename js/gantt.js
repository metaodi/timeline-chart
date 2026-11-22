/**
 * Gantt mode: model, Mermaid serialisation and import.
 *
 * Model (state.gantt):
 * {
 *   calendar: { startDate, sprintWeeks, sprintCount, sprintsPerPI, ipIteration, firstSprint, firstPI, sprintPrefix, piPrefix },
 *   showPIs: boolean,          // a "PIs" row at the top of the chart
 *   showSprints: boolean,      // a "Sprints" row
 *   excludeWeekends: boolean,
 *   todayMarker: boolean,
 *   sections: [{ name, tasks: Task[] }],
 * }
 * Task = {
 *   name: string,
 *   type: 'task' | 'milestone' | 'deadline',
 *   status: '' | 'done' | 'active' | 'crit',
 *   from: Ref,   // start (unused for milestones/deadlines)
 *   to: Ref,     // end, or the date of a milestone/deadline
 * }
 * Ref = "s3" (sprint id from the calendar: start or end of that sprint) or "YYYY-MM-DD".
 *
 * Referencing sprints keeps the plan in sync with the calendar: moving the
 * start date or changing the sprint length moves every task with it.
 */
import { DEFAULT_CALENDAR, sprintCalendar, parseDate, isoDate, addDays } from './generator.js';

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

const CAL_KEY = 'sprint-calendar';
const isSprintRef = (ref) => /^s\d+$/.test(ref ?? '');
const isDate = (ref) => /^\d{4}-\d{2}-\d{2}$/.test(ref ?? '');

export function emptyGantt() {
  return {
    calendar: { ...DEFAULT_CALENDAR, startDate: '' },
    showPIs: true,
    showSprints: true,
    excludeWeekends: false, // kept for imported charts; no UI (clean look)
    todayMarker: false,
    sections: [],
  };
}

export function newTask(from = 's1', to = from, type = 'task') {
  return { name: '', type, status: '', from, to };
}

export function newGanttSection(name = '', task = newTask()) {
  return { name, tasks: [task] };
}

export function normalizeGantt(g) {
  const base = emptyGantt();
  const d = { ...base, ...(g || {}) };
  d.calendar = { ...DEFAULT_CALENDAR, ...(d.calendar || {}) };
  for (const k of ['showPIs', 'showSprints', 'excludeWeekends', 'todayMarker']) d[k] = Boolean(d[k]);
  const types = TASK_TYPES.map((t) => t.id);
  const statuses = STATUSES.map((s) => s.id);
  d.sections = Array.isArray(d.sections)
    ? d.sections.map((s) => ({
        name: String(s?.name ?? ''),
        tasks: Array.isArray(s?.tasks)
          ? s.tasks.map((t) => ({
              name: String(t?.name ?? ''),
              type: types.includes(t?.type) ? t.type : 'task',
              status: statuses.includes(t?.status) ? t.status : '',
              from: String(t?.from ?? ''),
              to: String(t?.to ?? t?.from ?? ''),
            }))
          : [],
      }))
    : [];
  return d;
}

/** The calendar for a gantt model, or an empty one if no start date is set. */
export function calendarOf(g) {
  if (!isDate(g.calendar?.startDate)) return { sprints: [], pis: [] };
  try {
    return sprintCalendar(g.calendar);
  } catch {
    return { sprints: [], pis: [] };
  }
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
    `firstSprint=${c.firstSprint}`,
    `firstPI=${encodeURIComponent(c.firstPI)}`,
    `sprint=${encodeURIComponent(c.sprintPrefix)}`,
    `pi=${encodeURIComponent(c.piPrefix)}`,
  ];
  return `  %% ${CAL_KEY} ${parts.join(' ')}`;
}

/**
 * One task line, or null if its dates cannot be resolved.
 * `id` (e.g. "g0t2") lets gantt-style.js colour the bar by its section.
 */
export function taskLine(task, cal, id = '') {
  const name = escapeGanttText(task.name) || '&nbsp;';
  const tags = [];
  if (task.type === 'milestone') tags.push('milestone');
  if (task.type === 'deadline') tags.push('vert');
  if (task.status) tags.push(task.status);
  if (task.type !== 'task') {
    const at = resolveRef(task.to || task.from, 'end', cal);
    if (!at) return null;
    return `    ${name} : ${[...tags, id, isoDate(at), '0d'].filter(Boolean).join(', ')}`;
  }
  let start = resolveRef(task.from, 'start', cal);
  let end = resolveRef(task.to, 'end', cal);
  if (!start || !end) return null;
  if (end < start) [start, end] = [resolveRef(task.to, 'start', cal) ?? end, resolveRef(task.from, 'end', cal) ?? start];
  return `    ${name} : ${[...tags, id, isoDate(start), isoDate(end)].filter(Boolean).join(', ')}`;
}

/** @param {object} t full app state (title, accTitle, accDescr, theme, gantt) */
export function toGanttMermaid(t, frontmatter = []) {
  const g = normalizeGantt(t.gantt);
  const cal = calendarOf(g);
  const out = [...frontmatter, 'gantt'];
  if (t.title?.trim()) out.push(`  title ${t.title.replace(/\s*\n\s*/g, ' ').trim()}`);
  if (t.accTitle?.trim()) out.push(`  accTitle: ${t.accTitle.trim()}`);
  if (t.accDescr?.trim()) out.push(`  accDescr: ${t.accDescr.replace(/\s*\n\s*/g, ' ').trim()}`);
  out.push('  dateFormat YYYY-MM-DD', '  axisFormat %d %b');
  if (cal.sprints.length) out.push(`  tickInterval ${g.calendar.sprintWeeks}week`, '  weekday monday');
  if (g.excludeWeekends) out.push('  excludes weekends');
  out.push('  inclusiveEndDates');
  if (!g.todayMarker) out.push('  todayMarker off');
  if (cal.sprints.length) {
    out.push(calendarComment(g.calendar));
    if (g.showPIs && cal.pis.length) {
      out.push(`  section ${escapeGanttText(g.calendar.piPrefix || 'PI')}s`);
      for (const pi of cal.pis) out.push(`    ${escapeGanttText(pi.name)} : ${pi.id}, ${isoDate(pi.start)}, ${isoDate(pi.end)}`);
    }
    if (g.showSprints) {
      out.push(`  section ${escapeGanttText(g.calendar.sprintPrefix || 'Sprint')}s`);
      // Short labels ("1", "2", "IP") fit inside the bars when sprints sit side by side.
      for (const s of cal.sprints) out.push(`    ${escapeGanttText(s.short)} : ${s.id}, ${isoDate(s.start)}, ${isoDate(s.end)}`);
    }
  }
  g.sections.forEach((s, si) => {
    const lines = s.tasks.map((task, ti) => taskLine(task, cal, `g${si}t${ti}`)).filter(Boolean);
    out.push(`  section ${escapeGanttText(s.name) || '&nbsp;'}`, ...lines);
  });
  return out.join('\n') + '\n';
}

export function isGanttEmpty(g) {
  const cal = calendarOf(normalizeGantt(g));
  return !(g?.sections ?? []).some((s) => s.tasks.some((t) => taskLine(t, cal)));
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

  String(code)
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('%%')) {
        if (line.includes(CAL_KEY)) g.calendar = readCalendarComment(line);
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
      else if (/^(axisFormat|tickInterval|weekday|weekend|inclusiveEndDates|includes|excludes|topAxis|displayMode|click|classDef|class)\b/i.test(line)) {
        /* layout options this app sets itself */
      } else if ((m = line.match(/^section\s+(.*)$/i))) {
        section = { name: unescape(m[1]), tasks: [] };
        generated = null;
        g.sections.push(section);
      } else if ((m = line.match(/^([^:]+):(.*)$/))) {
        const name = unescape(m[1]);
        const parts = m[2].split(',').map((p) => p.trim()).filter(Boolean);
        const task = { name, type: 'task', status: '', from: '', to: '' };
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
        if (task.type !== 'task' && start) end = start;
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
        task.from = isoDate(start);
        task.to = isoDate(end);
        if (!section) {
          section = { name: '', tasks: [] };
          g.sections.push(section);
        }
        section.tasks.push(task);
      } else {
        res.warnings.push(`Line ${i + 1}: not understood: "${line}"`);
      }
    });

  snapToSprints(g);
  if (!seenHeader) res.warnings.unshift('No "gantt" header found');
  return res;
}

/** Replace dates that fall exactly on sprint boundaries with sprint references. */
export function snapToSprints(g) {
  const cal = calendarOf(g);
  if (!cal.sprints.length) return g;
  const byStart = new Map(cal.sprints.map((s) => [isoDate(s.start), s.id]));
  const byEnd = new Map(cal.sprints.map((s) => [isoDate(s.end), s.id]));
  for (const s of g.sections) {
    for (const t of s.tasks) {
      if (t.type === 'task') {
        if (byStart.has(t.from)) t.from = byStart.get(t.from);
        if (byEnd.has(t.to)) t.to = byEnd.get(t.to);
      } else if (byEnd.has(t.to)) {
        t.to = t.from = byEnd.get(t.to);
      } else {
        t.from = t.to;
      }
    }
  }
  return g;
}
