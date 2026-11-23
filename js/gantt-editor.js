/**
 * Editor UI for Gantt mode: plan start + sprint calendar, sections (teams,
 * epics…) and tasks defined by a start rule and a duration. Concrete dates are
 * computed by scheduleGantt() and shown under each task.
 */
import { TASK_TYPES, STATUSES, LOOKS, END_DATE_MODES, END_DATE_FORMATS, showsEndDate, AXIS_PRESETS, TICK_UNITS, DURATION_UNITS, SECTION_COLOURS, ROW_PRESETS, scheduleGantt, sectionColour, newTask, newGanttSection, newPlanSprint, newPlanPI, cleanWidthRange, AUTO_WIDTH, WIDTH_LIMITS } from './gantt.js';
import { themeVars, rowColour, themeColour } from './themes.js';
import { sortable, moveBetween } from './drag.js';
import { formatDate, isoDate, nextName } from './generator.js';

/** The scrolling editor column on desktop; on phones the page itself scrolls. */
export const editorScroller = () => (matchMedia('(max-width: 720px)').matches ? null : document.querySelector('.editor-pane'));

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const iconBtn = (action, label, glyph, extra = '') =>
  `<button type="button" class="ibtn ${extra}" data-gaction="${action}" title="${label}" aria-label="${label}">${glyph}</button>`;

const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

const DAY = 864e5;
function describe(when, type) {
  if (!when) return '<span class="warn">Cannot be placed – check the start.</span>';
  if (type !== 'task') return formatDate(when.start, 'long');
  const days = Math.round((when.end - when.start) / DAY) + 1;
  const span = days % 7 === 5 || days % 7 === 0 ? `${Math.round(days / 7)} wk` : `${days} days`;
  return `${formatDate(when.start)} – ${formatDate(when.end, 'long')} · ${span}`;
}

/**
 * @param {HTMLElement} root
 * @param {object} api
 * @param {() => object} api.getState
 * @param {(mutator: Function, focus?: string) => void} api.change  structural change (snapshot + re-render)
 * @param {() => void} api.snapshot
 * @param {() => void} api.snapshotTyping
 * @param {() => void} api.update   refresh code + preview only
 * @param {() => void} api.openCalendar
 */
export function createGanttEditor(root, api) {
  const g = () => api.getState().gantt;
  const sel = {
    section: (s) => `[data-gfield="section"][data-gs="${s}"]`,
    task: (s, t) => `[data-gfield="name"][data-gs="${s}"][data-gt="${t}"]`,
  };

  // ------------------------------------------------------------------ render

  function startSelect(task, s, t, cal, planStart) {
    const point = task.type !== 'task';
    const others = g()
      .sections.flatMap((sec) => sec.tasks)
      .filter((x) => x.id !== task.id && x.name.trim());
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(task.from);
    return `<select data-gfield="from" data-gs="${s}" data-gt="${t}" aria-label="${point ? 'On' : 'Start'}">
        ${option('prev', point ? 'End of previous' : 'After previous', task.from === 'prev')}
        ${option('plan', `Plan start${planStart ? ` (${formatDate(planStart)})` : ''}`, task.from === 'plan')}
        ${cal.sprints.length ? `<optgroup label="Sprint">${cal.sprints
          .map((sp) => option(sp.id, `${sp.name} (${formatDate(point ? sp.end : sp.start)})`, task.from === sp.id))
          .join('')}</optgroup>` : ''}
        ${others.length ? `<optgroup label="${point ? 'End of task' : 'After task'}">${others
          .map((x) => option(`after:${x.id}`, `${point ? 'End of' : 'After'}: ${x.name}`, task.from === `after:${x.id}`))
          .join('')}</optgroup>` : ''}
        ${option('date', 'Exact date…', isDate)}
      </select>${isDate ? `<input type="date" data-gfield="from-date" data-gs="${s}" data-gt="${t}" value="${task.from}" aria-label="Start date" />` : ''}`;
  }

  function durationInputs(task, s, t, cal) {
    const m = /^(\d+)([swd])$/.exec(task.duration);
    const n = m ? m[1] : '';
    const unit = m ? m[2] : 'until';
    const units = DURATION_UNITS.filter((u) => u.id !== 's' || cal.sprints.length || unit === 's');
    const end = task.to || '';
    const endIsSprint = cal.sprints.some((sp) => sp.id === end);
    const until =
      unit === 'until'
        ? `<select data-gfield="to" data-gs="${s}" data-gt="${t}" aria-label="End">
            ${cal.sprints.map((sp) => option(sp.id, `end of ${sp.name} (${formatDate(sp.end)})`, sp.id === end)).join('')}
            ${option('date', 'Exact date…', !endIsSprint)}
          </select>${endIsSprint ? '' : `<input type="date" data-gfield="to-date" data-gs="${s}" data-gt="${t}" value="${esc(end)}" aria-label="End date" />`}`
        : '';
    return `<span class="dur">
      ${unit === 'until' ? '' : `<input type="number" min="1" max="400" inputmode="numeric" data-gfield="dur-n" data-gs="${s}" data-gt="${t}" value="${n}" aria-label="Duration" />`}
      <select data-gfield="dur-unit" data-gs="${s}" data-gt="${t}" aria-label="Duration unit">
        ${units.map((u) => option(u.id, Number(n) === 1 ? u.one : u.many, u.id === unit)).join('')}
        ${option('until', 'until…', unit === 'until')}
      </select>${until}</span>`;
  }

  function taskHtml(task, s, t, sched) {
    const { cal, planStart } = sched;
    const type = TASK_TYPES.find((x) => x.id === task.type) ?? TASK_TYPES[0];
    const typePicker = `<span class="kind" title="Type"><span class="kind-icon" aria-hidden="true">${type.icon}</span>
      <select data-gfield="type" data-gs="${s}" data-gt="${t}" aria-label="Type">${TASK_TYPES.map(
        (x) => option(x.id, `${x.icon} ${x.label}`, x.id === task.type),
      ).join('')}</select></span>`;
    const status = `<select class="status" data-gfield="status" data-gs="${s}" data-gt="${t}" aria-label="Status">${STATUSES.map(
      (x) => option(x.id, x.label, x.id === task.status),
    ).join('')}</select>`;
    const look =
      task.type === 'task'
        ? `<select class="look" data-gfield="look" data-gs="${s}" data-gt="${t}" aria-label="Look">${LOOKS.map((x) =>
            option(x.id, x.label, x.id === (task.look ?? '')),
          ).join('')}</select>`
        : '';
    // end date of this entry on/off (only while the chart shows end dates)
    const shown = showsEndDate(g(), task);
    const endDate =
      g().endDates && task.type !== 'deadline'
        ? iconBtn('enddate', shown ? 'End date shown – click to hide it for this entry' : 'End date hidden – click to show it for this entry', '📅', shown ? 'has-note' : 'off')
        : '';
    const when =
      task.type === 'task'
        ? `<label>Start ${startSelect(task, s, t, cal, planStart)}</label><label>Duration ${durationInputs(task, s, t, cal)}</label>`
        : `<label>On ${startSelect(task, s, t, cal, planStart)}</label>`;
    const placeholder = task.type === 'task' ? 'Feature, epic, story…' : task.type === 'milestone' ? 'Release, demo…' : 'Code freeze, deadline…';
    return `<li class="gtask type-${task.type} status-${task.status || 'planned'}" data-gt="${t}">
      <div class="gtask-head">
        <span class="drag-handle drag-task" title="Drag to move – also to another section" aria-hidden="true">⠿</span>
        ${typePicker}
        <textarea rows="1" data-gfield="name" data-gs="${s}" data-gt="${t}" placeholder="${placeholder}">${esc(task.name)}</textarea>
        <span class="tools">${iconBtn('task-up', 'Move up', '↑')}${iconBtn('task-down', 'Move down', '↓')}${iconBtn('task-dup', 'Duplicate', '⧉')}${iconBtn('task-delete', 'Delete', '✕', 'del')}</span>
      </div>
      <div class="gtask-when">${when}${status}${look}${endDate}${iconBtn('note', task.note?.trim() ? 'Edit note' : 'Add a note (hover + below the chart)', '📝', task.note?.trim() ? 'has-note' : '')}${iconBtn('link', task.link ? 'Edit link' : 'Add a link (the entry becomes clickable)', '🔗', task.link ? 'has-note' : '')}</div>
      ${noteOpen.has(task.id) || task.note?.trim() ? `<textarea rows="1" class="gnote" data-gfield="note" data-gs="${s}" data-gt="${t}" placeholder="Note – shown on hover and below the chart; URLs become links">${esc(task.note ?? '')}</textarea>` : ''}
      ${linkOpen.has(task.id) || task.link ? `<input type="url" class="gnote glink" data-gfield="link" data-gs="${s}" data-gt="${t}" value="${esc(task.link ?? '')}" placeholder="https://… – opens when the entry is clicked" inputmode="url" />` : ''}
      <div class="gtask-dates">${describe(sched.dates[s][t], task.type)}</div>
    </li>`;
  }

  let planOpen = false; // remember whether the PI/sprint list is expanded
  let paletteOpen = -1; // section whose colour palette is shown
  const noteOpen = new Set(); // task ids whose (still empty) note field is shown
  const linkOpen = new Set(); // task ids whose (still empty) link field is shown

  const colourOf = (k) => themeVars(api.getState().theme)[`--pele-series-${k}`];

  /** Colour dot in the section header; opens the palette. */
  function swatch(s, cal) {
    const sec = g().sections[s];
    const k = sectionColour(g(), s, cal);
    const label = sec.color ? 'Section colour' : 'Section colour (automatic)';
    return `<button type="button" class="swatch${sec.color ? '' : ' auto'}" data-gaction="palette" style="--c:${colourOf(k)}" title="${label}" aria-label="${label}" aria-expanded="${paletteOpen === s}"></button>`;
  }

  function palette(s) {
    const current = g().sections[s].color || 0;
    const dots = Array.from({ length: SECTION_COLOURS }, (_, i) => i + 1)
      .map((k) => `<button type="button" class="swatch${k === current ? ' on' : ''}" data-gaction="colour" data-colour="${k}" style="--c:${colourOf(k)}" aria-label="Colour ${k}"></button>`)
      .join('');
    return `<div class="palette" role="group" aria-label="Section colour">
      <button type="button" class="btn small${current ? '' : ' on'}" data-gaction="colour" data-colour="0">Auto</button>${dots}</div>`;
  }

  function planHtml(cal) {
    const pis = g().pis;
    const dated = new Map(cal.sprints.map((x) => [x.id, x]));
    const piDates = new Map(cal.pis.map((x) => [x.id, x]));
    const range = (a, b) => (a && b ? `${formatDate(a)} – ${formatDate(b)}` : '');
    return pis
      .map((pi, i) => {
        const d = piDates.get(pi.id);
        const sprints = pi.sprints
          .map((sp, j) => {
            const x = dated.get(sp.id);
            return `<li class="gsprint" data-sp="${j}">
              <input type="text" data-gpfield="sp-name" value="${esc(sp.name)}" placeholder="Sprint name" aria-label="Sprint name" />
              <label class="weeks"><input type="number" min="1" max="12" inputmode="numeric" data-gpfield="sp-weeks" value="${sp.weeks}" aria-label="Length in weeks" /> wk</label>
              <span class="gdates">${x ? range(x.start, x.end) : ''}</span>
              <span class="tools">${iconBtn('sp-up', 'Move sprint up', '↑')}${iconBtn('sp-down', 'Move sprint down', '↓')}${iconBtn('sp-delete', 'Delete sprint', '✕', 'del')}</span>
            </li>`;
          })
          .join('');
        return `<div class="gpi" data-pi="${i}">
          <div class="gpi-head">
            <input type="text" data-gpfield="pi-name" value="${esc(pi.name)}" placeholder="PI name (empty = no PI)" aria-label="PI name" />
            <span class="gdates">${d ? range(d.start, d.end) : ''}</span>
            <span class="tools">${iconBtn('pi-up', 'Move PI up', '↑')}${iconBtn('pi-down', 'Move PI down', '↓')}${iconBtn('pi-delete', 'Delete PI', '✕', 'del')}</span>
          </div>
          <ul class="gsprints">${sprints}</ul>
          <button type="button" class="add-event" data-gaction="sp-add">+ Sprint</button>
        </div>`;
      })
      .join('');
  }

  /** Row stripes: preset + two colour pickers. */
  function rowsHtml() {
    const vars = themeVars(api.getState().theme);
    const rows = g().rows;
    const preset = Object.entries(ROW_PRESETS).find(([, p]) => p.rows.join() === rows.join())?.[0] ?? 'custom';
    const picker = (i) => {
      const c = rowColour(rows[i], vars);
      const value = c === 'none' ? themeColour(vars, '--pele-bg') : c;
      return `<input type="color" data-grows="${i}" value="${value}" title="Row colour ${i + 1}" aria-label="Row colour ${i + 1}" />`;
    };
    return `<div class="grows">
      <span class="muted small">Rows</span>
      <select data-grows="preset" aria-label="Row stripes">
        ${Object.entries(ROW_PRESETS).map(([id, p]) => option(id, p.label, id === preset)).join('')}
        ${option('custom', 'Custom', preset === 'custom')}
      </select>${picker(0)}${picker(1)}</div>`;
  }

  function calendarHtml({ cal }) {
    const c = g().calendar;
    const opt = (key, label) =>
      `<label class="check small"><input type="checkbox" data-gopt="${key}"${g()[key] ? ' checked' : ''} /> ${label}</label>`;
    const n = cal.sprints.length;
    const summary = n
      ? `${cal.pis.length ? `${cal.pis.length} PI${cal.pis.length > 1 ? 's' : ''} · ` : ''}${n} sprint${n > 1 ? 's' : ''} · ${formatDate(cal.sprints[0].start)} – ${formatDate(cal.sprints[n - 1].end, 'long')}`
      : 'no sprints';
    return `<div class="card gcal">
      <div class="gcal-head">
        <label class="field"><span>Plan starts</span><input type="date" data-gcal="startDate" value="${esc(c.startDate)}" /></label>
        <button type="button" class="btn small" data-gaction="calendar" title="Generate PIs and sprints from settings">Generate…</button>
      </div>
      <details class="gplan" data-gplan${planOpen ? ' open' : ''}>
        <summary>PIs &amp; sprints <span class="muted small">· ${summary}</span></summary>
        <div class="gplan-list">${planHtml(cal)}
          <button type="button" class="btn small" data-gaction="pi-add">+ PI</button>
        </div>
      </details>
      <div class="gcal-opts">${opt('showPIs', 'Show PIs')}${opt('showSprints', 'Show sprints')}${opt('showNotes', 'Notes below chart')}</div>
      <div class="grows">
        <span class="muted small">Order</span>
        <select data-glayout aria-label="Order of the entries">
          ${option('compact', 'Compact – packed by start date', g().layout !== 'ordered')}
          ${option('ordered', 'In my order – one row per entry', g().layout === 'ordered')}
        </select>
      </div>
      <div class="grows">
        <span class="muted small">Dates</span>
        <select data-genddates="mode" aria-label="End dates after bars and milestones">
          ${END_DATE_MODES.map((f) => option(f.id, f.label, f.id === g().endDates)).join('')}
        </select>
        ${
          g().endDates
            ? `<select data-genddates="format" aria-label="Format of the end dates">
          ${END_DATE_FORMATS.map((f) => option(f.id, f.label, f.id === g().endDateFormat)).join('')}
        </select>`
            : ''
        }
      </div>
      ${axisHtml()}
      ${widthHtml()}
      ${rowsHtml()}
    </div>`;
  }

  /** Chart width range in px (empty = automatic, min = max = fixed width). */
  function widthHtml() {
    const { minWidth, maxWidth } = g();
    const field = (key, value, auto, label) =>
      `<input type="number" data-gwidth="${key}" min="${WIDTH_LIMITS.min}" max="${WIDTH_LIMITS.max}" step="10"
        value="${value || ''}" placeholder="${auto}" aria-label="${label}" title="${label} in px (empty = automatic)" />`;
    return `<div class="grows gwidth" title="Chart width in pixels. Same value twice = fixed width.">
        <span class="muted small">Width</span>
        ${field('min', minWidth, AUTO_WIDTH.min, 'Minimum width')}
        <span class="muted small">–</span>
        ${field('max', maxWidth, AUTO_WIDTH.max, 'Maximum width')}
        <span class="muted small">px</span>
      </div>`;
  }

  let axisCustom = false; // "Custom…" chosen, even while the values still match a preset

  /** Time axis: presets, or a custom label format (strftime) and tick interval. */
  function axisHtml() {
    const { axisFormat, tickInterval } = g();
    const preset = AXIS_PRESETS.find((p) => p.format === axisFormat && p.tick === tickInterval);
    const custom = axisCustom || !preset;
    const m = /^(\d+)(\w+)$/.exec(tickInterval);
    const help = 'Label format (strftime): %d day, %m month, %Y year, %y 2-digit year, %b Jan, %B January, %V week number';
    return `<div class="grows gaxis">
        <span class="muted small">Axis</span>
        <select data-gaxis="preset" aria-label="Time axis">
          ${AXIS_PRESETS.map((p) => option(p.id, p.label, !custom && p === preset)).join('')}
          ${option('custom', 'Custom…', custom)}
        </select>
        ${
          custom
            ? `<input type="text" data-gaxis="format" value="${esc(axisFormat)}" placeholder="%d %b" title="${help}" aria-label="Axis label format" spellcheck="false" />
        <span class="muted small">every</span>
        <input type="number" data-gaxis="tick-n" min="1" max="999" value="${m ? m[1] : 1}" aria-label="Tick interval"${m ? '' : ' disabled'} />
        <select data-gaxis="tick-unit" aria-label="Tick unit">
          ${option('', g().calendar.startDate ? 'sprint (auto)' : 'auto', !m)}
          ${TICK_UNITS.map((u) => option(u, `${u}(s)`, m?.[2] === u)).join('')}
        </select>`
            : ''
        }
      </div>`;
  }

  /** Selector for the focused field, so focus survives a re-render. */
  function focusKey() {
    const el = document.activeElement;
    if (!el || !root.contains(el)) return null;
    const attr = ['gpfield', 'gfield', 'gcal', 'gaction', 'gaxis', 'gwidth'].find((k) => el.dataset[k]);
    const field = attr ? `[data-${attr}="${el.dataset[attr]}"]` : null;
    if (!field) return null;
    const scope = ['pi', 'sp', 'gs', 'gt']
      .map((k) => el.closest(`[data-${k}]`))
      .filter(Boolean)
      .map((c) => {
        const k = Object.keys(c.dataset).find((x) => ['pi', 'sp', 'gs', 'gt'].includes(x));
        return `[data-${k}="${c.dataset[k]}"]`;
      });
    return [...new Set(scope)].join(' ') + ' ' + field;
  }

  function render() {
    const keep = focusKey();
    const sched = scheduleGantt(g());
    const sections = g()
      .sections.map(
        (sec, s) => `<div class="group card section" data-gs="${s}" style="--sec:${colourOf(sectionColour(g(), s, sched.cal))}">
        <div class="group-head">
          ${swatch(s, sched.cal)}
          <textarea rows="1" class="section-name" data-gfield="section" data-gs="${s}" placeholder="Category, team, epic…">${esc(sec.name)}</textarea>
          <span class="tools">${iconBtn('section-up', 'Move section up', '↑')}${iconBtn('section-down', 'Move section down', '↓')}${iconBtn('section-dup', 'Duplicate section', '⧉')}${iconBtn('section-delete', 'Delete section', '✕', 'del')}</span>
        </div>
        ${paletteOpen === s ? palette(s) : ''}
        <ul class="gtasks">${sec.tasks.map((task, t) => taskHtml(task, s, t, sched)).join('')}</ul>
        <div class="gadd">
          <button type="button" class="add-event" data-gaction="add-task">+ Bar</button>
          <button type="button" class="add-event" data-gaction="add-milestone">+ Milestone</button>
          <button type="button" class="add-event" data-gaction="add-deadline">+ Deadline</button>
        </div>
      </div>`,
      )
      .join('');
    root.innerHTML = `${calendarHtml(sched)}
      <div class="tree">${sections || '<p class="empty card">Add a section for a team, epic or workstream.</p>'}</div>
      <div class="add-row"><button type="button" class="btn primary" data-gaction="add-section">+ Section (team, epic…)</button></div>
      <p class="hint">Give each bar a duration – it starts after the previous one. Dates are calculated for you.</p>`;
    root.querySelectorAll('textarea').forEach(autosize);
    if (keep && !root.contains(document.activeElement)) root.querySelector(keep)?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ helpers

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function locate(el) {
    const num = (attr) => {
      const v = el.closest(`[data-${attr}]`)?.dataset[attr];
      return v === undefined ? undefined : Number(v);
    };
    return { s: num('gs'), t: num('gt'), pi: num('pi'), sp: num('sp') };
  }

  /** Move a sprint up/down; at the edge of a PI it moves into the neighbouring PI. */
  function moveSprint(pi, sp, d) {
    const pis = g().pis;
    const list = pis[pi].sprints;
    const j = sp + d;
    if (j >= 0 && j < list.length) {
      [list[sp], list[j]] = [list[j], list[sp]];
    } else if (pis[pi + d]) {
      const [x] = list.splice(sp, 1);
      if (d < 0) pis[pi - 1].sprints.push(x);
      else pis[pi + 1].sprints.unshift(x);
    }
  }

  function move(arr, i, d) {
    const j = i + d;
    if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  const copy = (task) => ({ ...JSON.parse(JSON.stringify(task)), id: newTask().id });

  /** New tasks follow the previous one; the first task of a section starts at the plan start. */
  const addTask = (type) => ({ s }) => {
    const sec = g().sections[s];
    const from = sec.tasks.length ? 'prev' : 'plan';
    api.change(() => sec.tasks.push(newTask(type, from)), sel.task(s, sec.tasks.length));
  };

  const sprintWeeks = () => Number(g().calendar.sprintWeeks) || 2;

  /**
   * Name for a new sprint at the end of PI `pi`: continues the numbering of that
   * PI; in a PI without numbered sprints it starts at 1 ("restart numbering")
   * or continues from the previous PIs.
   */
  function nextSprintName(pi) {
    const c = g().calendar;
    const numbered = (list) => list.filter((x) => /\d+\s*$/.test(x.name) && !/^IP\b/i.test(x.name)).pop();
    const own = numbered(g().pis[pi]?.sprints ?? []);
    if (own) return nextName(own.name.trim());
    const first = `${c.sprintPrefix || 'Sprint'} ${Number(c.firstSprint) || 1}`;
    if (c.restartNumbering) return first;
    const before = numbered(g().pis.slice(0, pi).flatMap((p) => p.sprints));
    return before ? nextName(before.name.trim()) : first;
  }
  const actions = {
    calendar: () => api.openCalendar(),
    link: ({ s, t }) => {
      const sel = `[data-gfield="link"][data-gs="${s}"][data-gt="${t}"]`;
      if (!root.querySelector(sel)) {
        linkOpen.add(g().sections[s].tasks[t].id);
        render();
      }
      root.querySelector(sel)?.focus();
    },
    enddate: ({ s, t }) => {
      const task = g().sections[s].tasks[t];
      const shown = showsEndDate(g(), task);
      // store the override; back to "follow the chart" when it matches the chart's setting
      api.change(() => (task.endDate = shown ? (g().endDates === 'all' ? 'hide' : '') : g().endDates === 'some' ? 'show' : ''));
    },
    note: ({ s, t }) => {
      const task = g().sections[s].tasks[t];
      const field = root.querySelector(`[data-gfield="note"][data-gs="${s}"][data-gt="${t}"]`);
      if (field) return field.focus();
      noteOpen.add(task.id);
      render();
      root.querySelector(`[data-gfield="note"][data-gs="${s}"][data-gt="${t}"]`)?.focus();
    },
    palette: ({ s }) => {
      paletteOpen = paletteOpen === s ? -1 : s;
      render();
    },
    'pi-add': () =>
      api.change(() => {
        const pis = g().pis;
        const pi = newPlanPI(pis, '', sprintWeeks());
        const last = pis.filter((p) => p.name.trim()).pop()?.name;
        pi.name = last ? nextName(last) : `${g().calendar.piPrefix || 'PI'} 1`;
        pi.sprints[0].name = nextSprintName(pis.length);
        pis.push(pi);
      }, `[data-pi="${g().pis.length}"] [data-gpfield="pi-name"]`),
    'pi-up': ({ pi }) => api.change(() => move(g().pis, pi, -1)),
    'pi-down': ({ pi }) => api.change(() => move(g().pis, pi, 1)),
    'pi-delete': ({ pi }) => api.change(() => g().pis.splice(pi, 1)),
    'sp-add': ({ pi }) => {
      const list = g().pis[pi].sprints;
      api.change(() => {
        list.push(newPlanSprint(g().pis, nextSprintName(pi), list[list.length - 1]?.weeks ?? sprintWeeks()));
      }, `[data-pi="${pi}"] [data-sp="${list.length}"] [data-gpfield="sp-name"]`);
    },
    'sp-up': ({ pi, sp }) => api.change(() => moveSprint(pi, sp, -1)),
    'sp-down': ({ pi, sp }) => api.change(() => moveSprint(pi, sp, 1)),
    'sp-dup': ({ pi, sp }) =>
      api.change(() => {
        const x = g().pis[pi].sprints[sp];
        g().pis[pi].sprints.splice(sp + 1, 0, newPlanSprint(g().pis, x.name, x.weeks));
      }),
    'sp-delete': ({ pi, sp }) => api.change(() => g().pis[pi].sprints.splice(sp, 1)),
    'add-section': () => {
      const n = g().sections.length;
      api.change(() => g().sections.push(newGanttSection()), sel.section(n));
    },
    'section-up': ({ s }) => api.change(() => move(g().sections, s, -1)),
    'section-down': ({ s }) => api.change(() => move(g().sections, s, 1)),
    'section-dup': ({ s }) =>
      api.change(() => {
        const sec = g().sections[s];
        g().sections.splice(s + 1, 0, { name: sec.name, color: sec.color, tasks: sec.tasks.map(copy) });
      }, sel.section(s + 1)),
    'section-delete': ({ s }) => api.change(() => g().sections.splice(s, 1)),
    'add-task': addTask('task'),
    'add-milestone': addTask('milestone'),
    'add-deadline': addTask('deadline'),
    // at the edge of a section, ↑/↓ move the task into the neighbouring section
    'task-up': ({ s, t }) =>
      api.change(() => {
        const secs = g().sections;
        if (t > 0) move(secs[s].tasks, t, -1);
        else if (secs[s - 1]) moveBetween(secs[s].tasks, 0, secs[s - 1].tasks, secs[s - 1].tasks.length);
      }),
    'task-down': ({ s, t }) =>
      api.change(() => {
        const secs = g().sections;
        if (t < secs[s].tasks.length - 1) move(secs[s].tasks, t, 1);
        else if (secs[s + 1]) moveBetween(secs[s].tasks, t, secs[s + 1].tasks, 0);
      }),
    'task-dup': ({ s, t }) => api.change(() => g().sections[s].tasks.splice(t + 1, 0, copy(g().sections[s].tasks[t])), sel.task(s, t + 1)),
    'task-delete': ({ s, t }) => api.change(() => g().sections[s].tasks.splice(t, 1)),
  };

  // ------------------------------------------------------------------ events

  root.addEventListener(
    'toggle',
    (ev) => {
      if (ev.target.matches?.('[data-gplan]')) planOpen = ev.target.open;
    },
    true,
  );

  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-gaction]');
    if (!btn) return;
    if (btn.dataset.gaction === 'colour') {
      const { s } = locate(btn);
      paletteOpen = -1;
      api.change(() => (g().sections[s].color = Number(btn.dataset.colour) || 0));
      return;
    }
    actions[btn.dataset.gaction]?.(locate(btn));
  });

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    // PI / sprint names: update the chart while typing (dates do not change)
    if (el.dataset.gpfield === 'pi-name' || el.dataset.gpfield === 'sp-name') {
      api.snapshotTyping();
      const { pi, sp } = locate(el);
      if (el.dataset.gpfield === 'pi-name') g().pis[pi].name = el.value;
      else g().pis[pi].sprints[sp].name = el.value;
      api.update();
      return;
    }
    const field = el.dataset.gfield;
    if (el.tagName !== 'TEXTAREA' || !field) return;
    autosize(el);
    api.snapshotTyping();
    const { s, t } = locate(el);
    if (field === 'section') g().sections[s].name = el.value;
    else if (field === 'name') g().sections[s].tasks[t].name = el.value;
    else if (field === 'note') g().sections[s].tasks[t].note = el.value;
    api.update();
  });

  root.addEventListener('change', (ev) => {
    // Text/number/date inputs report "change" when focus leaves them (e.g. Tab):
    // re-render after the focus has moved, so it can be restored on the new field.
    if (ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox') setTimeout(() => onChange(ev), 0);
    else onChange(ev);
  });

  function onChange(ev) {
    const el = ev.target;
    if (el.hasAttribute('data-glayout')) {
      api.change(() => (g().layout = el.value === 'ordered' ? 'ordered' : 'compact'));
      return;
    }
    if (el.dataset.gaxis) {
      const which = el.dataset.gaxis;
      if (which === 'preset') {
        const p = AXIS_PRESETS.find((x) => x.id === el.value);
        axisCustom = !p;
        if (p) api.change(() => Object.assign(g(), { axisFormat: p.format, tickInterval: p.tick }));
        else render(); // just show the custom fields (prefilled with the current values)
        return;
      }
      axisCustom = true;
      const row = el.closest('.gaxis');
      const n = Math.max(1, Math.min(999, Math.round(Number(row.querySelector('[data-gaxis="tick-n"]').value) || 1)));
      const unit = row.querySelector('[data-gaxis="tick-unit"]').value;
      api.change(() => {
        if (which === 'format') g().axisFormat = el.value.replace(/[#;]/g, '').trim();
        else g().tickInterval = unit ? `${n}${unit}` : '';
      });
      return;
    }
    if (el.dataset.gwidth) {
      api.change(() => {
        g()[el.dataset.gwidth === 'min' ? 'minWidth' : 'maxWidth'] = Number(el.value) || 0;
        Object.assign(g(), cleanWidthRange(g().minWidth, g().maxWidth));
      });
      return;
    }
    if (el.dataset.genddates === 'mode') {
      api.change(() => (g().endDates = END_DATE_MODES.some((f) => f.id === el.value) ? el.value : ''));
      return;
    }
    if (el.dataset.genddates === 'format') {
      api.change(() => (g().endDateFormat = END_DATE_FORMATS.some((f) => f.id === el.value) ? el.value : 'dmy'));
      return;
    }
    if (el.dataset.grows) {
      const which = el.dataset.grows;
      if (which === 'preset') {
        if (ROW_PRESETS[el.value]) api.change(() => (g().rows = [...ROW_PRESETS[el.value].rows]));
      } else {
        api.change(() => (g().rows[Number(which)] = el.value.toLowerCase()));
      }
      return;
    }
    if (el.dataset.gopt) {
      api.snapshot();
      g()[el.dataset.gopt] = el.checked;
      api.update();
      return;
    }
    if (el.dataset.gcal) {
      if (el.value) api.change(() => (g().calendar[el.dataset.gcal] = el.value));
      return;
    }
    if (el.dataset.gpfield === 'sp-weeks') {
      const { pi, sp } = locate(el);
      api.change(() => (g().pis[pi].sprints[sp].weeks = Math.max(1, Math.min(12, Math.round(Number(el.value) || 1)))));
      return;
    }
    if (el.dataset.gpfield) return; // names are applied while typing
    const field = el.dataset.gfield;
    if (!field || el.tagName === 'TEXTAREA') return;
    const { s, t } = locate(el);
    const task = g().sections[s].tasks[t];
    const sched = scheduleGantt(g());
    const when = sched.dates[s][t];
    const m = /^(\d+)([swd])$/.exec(task.duration);
    api.change(() => {
      switch (field) {
        case 'type':
          task.type = el.value;
          if (task.type !== 'task') task.duration = '';
          else if (!task.duration) task.duration = sched.cal.sprints.length ? '1s' : '2w';
          break;
        case 'status':
          task.status = el.value;
          break;
        case 'look':
          task.look = LOOKS.some((l) => l.id === el.value) ? el.value : '';
          break;
        case 'link': {
          // add https:// to bare addresses like "jira.example.com/ABC-1"
          const v = el.value.trim();
          task.link = !v || /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
          break;
        }
        case 'from':
          // "Exact date…" starts from the currently computed date
          task.from = el.value === 'date' ? isoDate(when?.start ?? sched.planStart ?? new Date()) : el.value;
          break;
        case 'from-date':
          if (el.value) task.from = el.value;
          break;
        case 'dur-n':
          task.duration = `${Math.max(1, Math.round(Number(el.value) || 1))}${m ? m[2] : 'w'}`;
          break;
        case 'dur-unit':
          if (el.value === 'until') {
            task.duration = '';
            task.to = when ? isoDate(when.end) : '';
          } else {
            task.duration = `${m ? m[1] : 1}${el.value}`;
          }
          break;
        case 'to':
          task.to = el.value === 'date' ? isoDate(when?.end ?? new Date()) : el.value;
          break;
        case 'to-date':
          if (el.value) task.to = el.value;
          break;
      }
    });
  }

  /** Enter in a task name adds the next task (starting after it). */
  root.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key === 'Enter' && el.dataset.gpfield === 'sp-name') {
      ev.preventDefault();
      actions['sp-add'](locate(el));
      return;
    }
    if (ev.key !== 'Enter' || ev.isComposing || el.tagName !== 'TEXTAREA' || el.dataset.gfield === 'note') return;
    ev.preventDefault();
    const { s, t } = locate(el);
    const sec = g().sections[s];
    if (el.dataset.gfield === 'section') {
      if (sec.tasks.length) root.querySelector(sel.task(s, 0))?.focus();
      else addTask('task')({ s });
    } else {
      api.change(() => sec.tasks.splice(t + 1, 0, newTask(sec.tasks[t].type, 'prev')), sel.task(s, t + 1));
    }
  });

  // Drag tasks by their handle, also into another section
  sortable(root, {
    handle: '.drag-task',
    item: '.gtask',
    containerAt: (el) => el.closest('.group.section')?.querySelector('.gtasks') ?? null,
    scroller: editorScroller,
    onDrop: (item, container, index) => {
      const { s, t } = locate(item);
      const to = Number(container.closest('[data-gs]').dataset.gs);
      api.change(() => moveBetween(g().sections[s].tasks, t, g().sections[to].tasks, index));
    },
  });

  return { render, autosizeAll: () => root.querySelectorAll('textarea').forEach(autosize) };
}
