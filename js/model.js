/**
 * Timeline data model and Mermaid serialisation.
 *
 * The model mirrors the Mermaid `timeline` grammar:
 *
 *   timeline [LR|TD]
 *     title <text>
 *     accTitle: <text>
 *     accDescr: <text>
 *     <period> : <event> : <event>     <- periods before the first section are "ungrouped"
 *     section <name>
 *       <period> : <event>
 *                : <event>             <- continuation lines add more events
 *
 * Model shape (plain JSON, so it can be stored and extended easily):
 *
 * {
 *   title: string,
 *   direction: 'LR' | 'TD',
 *   theme: 'default' | 'neutral' | 'dark' | 'forest' | 'base',
 *   disableMulticolor: boolean,
 *   accTitle: string,
 *   accDescr: string,
 *   periods: Period[],        // ungrouped periods (rendered before any section)
 *   sections: Section[],
 * }
 * Section = { name: string, periods: Period[] }
 * Period  = { label: string, events: string[] }
 *
 * Line breaks inside any text are stored as "\n" and written as <br>.
 */

import { emptyGantt, normalizeGantt, toGanttMermaid, isGanttEmpty } from './gantt.js';

export const MODES = ['timeline', 'gantt'];
export const DIRECTIONS = ['LR', 'TD'];
export const THEMES = ['default', 'neutral', 'dark', 'forest', 'base'];

/**
 * Item types. Mermaid timelines have no native milestone/deadline concept, so a
 * type is stored as an emoji prefix on the text: it renders in the chart and
 * survives copying/importing the Mermaid code. Add new kinds here.
 */
export const KINDS = [
  { id: 'item', icon: '', label: 'Item' },
  { id: 'milestone', icon: '🏁', label: 'Milestone' },
  { id: 'deadline', icon: '⏰', label: 'Deadline' },
  { id: 'release', icon: '🚀', label: 'Release' },
  { id: 'risk', icon: '⚠️', label: 'Risk / blocker' },
  { id: 'done', icon: '✅', label: 'Done' },
];

/** Strip an optional variation selector so "⚠" and "⚠️" match. */
const bare = (s) => s.replace(/️/g, '');

export function getKind(text) {
  const t = bare(String(text).trimStart());
  return KINDS.find((k) => k.icon && t.startsWith(bare(k.icon)))?.id ?? 'item';
}

/** Text without its kind prefix. */
export function stripKind(text) {
  const kind = KINDS.find((k) => k.id === getKind(text));
  if (!kind.icon) return String(text);
  return String(text).trimStart().slice(bare(kind.icon).length).replace(/^️/, '').trimStart();
}

export function setKind(text, kindId) {
  const kind = KINDS.find((k) => k.id === kindId) ?? KINDS[0];
  const rest = stripKind(text);
  return kind.icon ? `${kind.icon} ${rest}` : rest;
}

export function emptyTimeline() {
  return {
    mode: 'timeline', // 'timeline' | 'gantt' (see gantt.js)
    title: '',
    direction: 'LR',
    theme: 'default',
    disableMulticolor: false,
    titleAlign: 'center', // 'center' | 'left' (applied to the rendered SVG, not part of Mermaid)
    accTitle: '',
    accDescr: '',
    periods: [],
    sections: [],
    gantt: emptyGantt(),
  };
}

export function newPeriod(label = '') {
  return { label, events: [] };
}

export function newSection(name = '') {
  return { name, periods: [newPeriod()] };
}

/** Fill in missing fields so older/partial data (e.g. from storage) is safe to use. */
export function normalize(data) {
  const base = emptyTimeline();
  const d = { ...base, ...(data || {}) };
  if (!MODES.includes(d.mode)) d.mode = base.mode;
  d.gantt = normalizeGantt(d.gantt);
  if (!DIRECTIONS.includes(d.direction)) d.direction = base.direction;
  if (!THEMES.includes(d.theme)) d.theme = base.theme;
  d.disableMulticolor = Boolean(d.disableMulticolor);
  const period = (p) => ({
    label: String(p?.label ?? ''),
    events: Array.isArray(p?.events) ? p.events.map(String) : [],
  });
  d.periods = Array.isArray(d.periods) ? d.periods.map(period) : [];
  d.sections = Array.isArray(d.sections)
    ? d.sections.map((s) => ({
        name: String(s?.name ?? ''),
        periods: Array.isArray(s?.periods) ? s.periods.map(period) : [],
      }))
    : [];
  for (const k of ['title', 'accTitle', 'accDescr']) d[k] = String(d[k] ?? '');
  d.titleAlign = d.titleAlign === 'left' ? 'left' : 'center';
  return d;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

const BR = '<br>';

/** Newlines -> <br>, trim each line. */
function lines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .join(BR);
}

/**
 * Escape text used as a period label or event.
 * The grammar splits events on ":" followed by whitespace and treats "#" as a
 * comment start, so both are written as Mermaid entity codes.
 */
export function escapeItem(text) {
  return lines(text)
    .replace(/#/g, '#35;')
    .replace(/:(?=\s|$)/g, '#58;');
}

/** Section names cannot contain any ":" at all. */
export function escapeSection(text) {
  return lines(text).replace(/#/g, '#35;').replace(/:/g, '#58;');
}

/** Title / accessibility texts: single line, anything goes. */
function escapeLine(text) {
  return String(text).replace(/\s*\r?\n\s*/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function frontmatter(t) {
  const out = [];
  if (t.theme !== 'default') out.push(`  theme: ${t.theme}`);
  if (t.disableMulticolor && t.mode === 'timeline') out.push('  timeline:', '    disableMulticolor: true');
  // Compact: bars that don't overlap share a row, so sprints sit side by side instead of a "staircase".
  if (t.mode === 'gantt') out.push('  gantt:', '    displayMode: compact');
  return out.length ? ['---', 'config:', ...out, '---'] : [];
}

function periodLines(period, indent) {
  const label = escapeItem(period.label);
  const events = period.events.filter((e) => e.trim() !== '').map(escapeItem);
  if (!label && events.length === 0) return [];
  // A period needs a label; fall back to a non-breaking space so events still render.
  const head = label || '&nbsp;';
  return [indent + [head, ...events].join(' : ')];
}

/** Convert the model into Mermaid timeline code. */
export function toMermaid(data) {
  const t = normalize(data);
  if (t.mode === 'gantt') return toGanttMermaid(t, frontmatter(t));
  const out = [...frontmatter(t)];
  out.push(t.direction === 'LR' ? 'timeline' : `timeline ${t.direction}`);
  if (t.title.trim()) out.push(`  title ${escapeLine(t.title)}`);
  if (t.accTitle.trim()) out.push(`  accTitle: ${escapeLine(t.accTitle)}`);
  if (t.accDescr.trim()) {
    const descr = t.accDescr.trim();
    if (descr.includes('\n')) {
      out.push('  accDescr {', ...descr.split(/\r?\n/).map((l) => `    ${l.replace(/}/g, '')}`), '  }');
    } else {
      out.push(`  accDescr: ${descr}`);
    }
  }
  for (const p of t.periods) out.push(...periodLines(p, '  '));
  for (const s of t.sections) {
    const name = escapeSection(s.name) || '&nbsp;';
    out.push(`  section ${name}`);
    for (const p of s.periods) out.push(...periodLines(p, '    '));
  }
  return out.join('\n') + '\n';
}

/** True if the timeline has nothing Mermaid could draw. */
export function isEmpty(data) {
  const t = normalize(data);
  if (t.mode === 'gantt') return isGanttEmpty(t.gantt);
  const hasPeriod = (ps) => ps.some((p) => p.label.trim() || p.events.some((e) => e.trim()));
  return !hasPeriod(t.periods) && !t.sections.some((s) => hasPeriod(s.periods));
}
