/**
 * Parse Mermaid timeline code back into the editor model (see model.js).
 * Lenient on purpose: unknown lines are reported as warnings, not errors.
 */
import { emptyTimeline, newPeriod, THEMES } from './model.js';

/** Turn Mermaid text back into editor text: <br> -> newline, entity codes -> chars. */
export function unescapeText(text) {
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/** Split "a : b : c" on colons followed by whitespace (as the Mermaid lexer does). */
function splitEvents(text) {
  return text.split(/:(?=\s)/).map((s) => unescapeText(s));
}

/** Minimal frontmatter reader: only the keys this app understands. */
function readFrontmatter(block, t) {
  const theme = block.match(/^\s*theme:\s*['"]?([\w-]+)/m);
  if (theme && THEMES.includes(theme[1])) t.theme = theme[1];
  if (/^\s*disableMulticolor:\s*true\b/m.test(block)) t.disableMulticolor = true;
}

/**
 * @param {string} code Mermaid timeline source
 * @returns {{ timeline: object, warnings: string[] }}
 */
export function parseMermaid(code) {
  const t = emptyTimeline();
  const warnings = [];
  let src = String(code).replace(/\r\n?/g, '\n');

  const fm = src.match(/^\s*---\n([\s\S]*?)\n---\s*\n/);
  if (fm) {
    readFrontmatter(fm[1], t);
    src = src.slice(fm[0].length);
  }
  // %%{init: {"theme": "dark"}}%% directives
  const init = src.match(/%%\{\s*init:[\s\S]*?["']theme["']\s*:\s*["']([\w-]+)["']/);
  if (init && THEMES.includes(init[1])) t.theme = init[1];

  const lines = src.split('\n');
  let seenHeader = false;
  let section = null; // current section or null (= ungrouped)
  let period = null; // last period, for continuation lines
  let inAccDescr = false;
  const accDescr = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (inAccDescr) {
      const end = line.indexOf('}');
      accDescr.push(end >= 0 ? line.slice(0, end) : line);
      if (end >= 0) inAccDescr = false;
      return;
    }
    if (!line || line.startsWith('%%')) return;

    if (!seenHeader) {
      const m = line.match(/^timeline(?:\s+(LR|TD))?\s*$/i);
      if (m) {
        seenHeader = true;
        if (m[1]) t.direction = m[1].toUpperCase();
      } else {
        warnings.push(`Line ${i + 1}: expected "timeline", got "${line}"`);
      }
      return;
    }

    let m;
    if ((m = line.match(/^title\s+(.+)$/i))) {
      t.title = m[1].trim();
    } else if ((m = line.match(/^accTitle\s*:\s*(.*)$/))) {
      t.accTitle = m[1].trim();
    } else if ((m = line.match(/^accDescr\s*:\s*(.*)$/))) {
      t.accDescr = m[1].trim();
    } else if ((m = line.match(/^accDescr\s*\{(.*)$/))) {
      const rest = m[1];
      const end = rest.indexOf('}');
      accDescr.length = 0;
      accDescr.push(end >= 0 ? rest.slice(0, end) : rest);
      inAccDescr = end < 0;
    } else if ((m = line.match(/^section\s+(.*)$/i))) {
      section = { name: unescapeText(m[1]), periods: [] };
      t.sections.push(section);
      period = null;
    } else if (line.startsWith(':')) {
      // continuation line: more events for the previous period
      if (!period) {
        warnings.push(`Line ${i + 1}: event without a time period`);
        return;
      }
      period.events.push(...splitEvents(line.slice(1)).filter(Boolean));
    } else {
      const [label, ...events] = splitEvents(line);
      period = newPeriod(label);
      period.events = events.filter(Boolean);
      (section ? section.periods : t.periods).push(period);
    }
  });

  if (accDescr.length) t.accDescr = accDescr.map((l) => l.trim()).filter(Boolean).join('\n');
  if (!seenHeader) warnings.unshift('No "timeline" header found');
  return { timeline: t, warnings };
}
