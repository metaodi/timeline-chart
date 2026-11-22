/**
 * Editor UI for Gantt mode: calendar summary, sections (teams, epics…) and
 * tasks whose start/end reference sprints from the calendar or exact dates.
 */
import { TASK_TYPES, STATUSES, calendarOf, resolveRef, newTask, newGanttSection } from './gantt.js';
import { formatDate, isoDate } from './generator.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const iconBtn = (action, label, glyph, extra = '') =>
  `<button type="button" class="ibtn ${extra}" data-gaction="${action}" title="${label}" aria-label="${label}">${glyph}</button>`;

const range = (a, b) => `${formatDate(a)} – ${formatDate(b)}`;

/**
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

  function refSelect(field, value, cal, edge, s, t) {
    const isSprint = cal.sprints.some((x) => x.id === value);
    const opts = cal.sprints
      .map((sp) => {
        const d = edge === 'start' ? sp.start : sp.end;
        const label = edge === 'at' ? `${sp.name} (end, ${formatDate(sp.end)})` : `${sp.name} (${formatDate(d)})`;
        return `<option value="${sp.id}"${sp.id === value ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('');
    const date = resolveRef(value, edge === 'start' ? 'start' : 'end', cal);
    return `<span class="ref">
      <select data-gfield="${field}" data-gs="${s}" data-gt="${t}" aria-label="${field === 'from' ? 'Start' : 'End'}">
        ${opts}<option value="date"${isSprint ? '' : ' selected'}>Exact date…</option>
      </select>
      ${isSprint ? '' : `<input type="date" data-gfield="${field}-date" data-gs="${s}" data-gt="${t}" value="${date ? isoDate(date) : ''}" aria-label="Date" />`}
    </span>`;
  }

  function taskHtml(task, s, t, cal) {
    const type = TASK_TYPES.find((x) => x.id === task.type) ?? TASK_TYPES[0];
    const typePicker = `<span class="kind" title="Type"><span class="kind-icon" aria-hidden="true">${type.icon}</span>
      <select data-gfield="type" data-gs="${s}" data-gt="${t}" aria-label="Type">${TASK_TYPES.map(
        (x) => `<option value="${x.id}"${x.id === task.type ? ' selected' : ''}>${x.icon} ${x.label}</option>`,
      ).join('')}</select></span>`;
    const status = `<select class="status" data-gfield="status" data-gs="${s}" data-gt="${t}" aria-label="Status">${STATUSES.map(
      (x) => `<option value="${x.id}"${x.id === task.status ? ' selected' : ''}>${x.label}</option>`,
    ).join('')}</select>`;
    const when =
      task.type === 'task'
        ? `<label>From ${refSelect('from', task.from, cal, 'start', s, t)}</label><label>to ${refSelect('to', task.to, cal, 'end', s, t)}</label>`
        : `<label>On ${refSelect('to', task.to, cal, 'at', s, t)}</label>`;
    return `<li class="gtask type-${task.type} status-${task.status || 'planned'}" data-gt="${t}">
      <div class="gtask-head">
        ${typePicker}
        <textarea rows="1" data-gfield="name" data-gs="${s}" data-gt="${t}" placeholder="${task.type === 'task' ? 'Feature, epic, story…' : task.type === 'milestone' ? 'Release, demo…' : 'Code freeze, deadline…'}">${esc(task.name)}</textarea>
        <span class="tools">${iconBtn('task-up', 'Move up', '↑')}${iconBtn('task-down', 'Move down', '↓')}${iconBtn('task-dup', 'Duplicate', '⧉')}${iconBtn('task-delete', 'Delete', '✕', 'del')}</span>
      </div>
      <div class="gtask-when">${when}${status}</div>
    </li>`;
  }

  function calendarHtml(cal) {
    const c = g().calendar;
    const opt = (key, label) =>
      `<label class="check small"><input type="checkbox" data-gopt="${key}"${g()[key] ? ' checked' : ''} /> ${label}</label>`;
    const summary = cal.sprints.length
      ? `<strong>${cal.sprints.filter((x) => !x.ip).length} sprints</strong> × ${c.sprintWeeks} weeks from ${formatDate(cal.sprints[0].start, 'long')}${
          cal.pis.length ? ` · ${cal.pis.length} PI${cal.pis.length > 1 ? 's' : ''} of ${c.sprintsPerPI} sprints${c.ipIteration ? ' + IP' : ''}` : ''
        }<br><span class="muted small">${range(cal.sprints[0].start, cal.sprints[cal.sprints.length - 1].end)}</span>`
      : '<span class="muted">No sprint calendar yet – tasks use exact dates.</span>';
    return `<div class="card gcal">
      <div class="gcal-head"><div>${summary}</div>
        <button type="button" class="btn small" data-gaction="calendar">${cal.sprints.length ? 'Edit calendar' : 'Set up sprints'}</button></div>
      <div class="gcal-opts">${opt('showPIs', 'Show PIs')}${opt('showSprints', 'Show sprints')}</div>
    </div>`;
  }

  function render() {
    const cal = calendarOf(g());
    const sections = g()
      .sections.map(
        (sec, s) => `<div class="group card section" data-gs="${s}">
        <div class="group-head">
          <textarea rows="1" class="section-name" data-gfield="section" data-gs="${s}" placeholder="Team, epic, workstream…">${esc(sec.name)}</textarea>
          <span class="tools">${iconBtn('section-up', 'Move section up', '↑')}${iconBtn('section-down', 'Move section down', '↓')}${iconBtn('section-dup', 'Duplicate section', '⧉')}${iconBtn('section-delete', 'Delete section', '✕', 'del')}</span>
        </div>
        <ul class="gtasks">${sec.tasks.map((task, t) => taskHtml(task, s, t, cal)).join('')}</ul>
        <div class="gadd">
          <button type="button" class="add-event" data-gaction="add-task">+ Bar</button>
          <button type="button" class="add-event" data-gaction="add-milestone">+ Milestone</button>
          <button type="button" class="add-event" data-gaction="add-deadline">+ Deadline</button>
        </div>
      </div>`,
      )
      .join('');
    root.innerHTML = `${calendarHtml(cal)}
      <div class="tree">${sections || '<p class="empty card">Add a section for a team, epic or workstream.</p>'}</div>
      <div class="add-row"><button type="button" class="btn primary" data-gaction="add-section">+ Section (team, epic…)</button></div>
      <p class="hint">Bars can span several sprints: pick a start and an end sprint. Changing the calendar moves all tasks with it.</p>`;
    root.querySelectorAll('textarea').forEach(autosize);
  }

  // ------------------------------------------------------------------ helpers

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function locate(el) {
    const s = el.closest('[data-gs]')?.dataset.gs;
    const t = el.closest('[data-gt]')?.dataset.gt;
    return { s: s === undefined ? undefined : Number(s), t: t === undefined ? undefined : Number(t) };
  }

  function move(arr, i, d) {
    const j = i + d;
    if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** A sensible default position for a new task: after the section's last task. */
  function nextTask(sec, type) {
    const cal = calendarOf(g());
    const last = sec?.tasks[sec.tasks.length - 1];
    const ref = last?.to || cal.sprints[0]?.id || isoDate(new Date());
    return newTask(type === 'task' ? last?.from || ref : ref, ref, type);
  }

  const addTask = (type) => ({ s }) => {
    const sec = g().sections[s];
    api.change(() => sec.tasks.push(nextTask(sec, type)), sel.task(s, sec.tasks.length));
  };

  const actions = {
    calendar: () => api.openCalendar(),
    'add-section': () => {
      const n = g().sections.length;
      api.change(() => g().sections.push(newGanttSection('', nextTask(null, 'task'))), sel.section(n));
    },
    'section-up': ({ s }) => api.change(() => move(g().sections, s, -1)),
    'section-down': ({ s }) => api.change(() => move(g().sections, s, 1)),
    'section-dup': ({ s }) => api.change(() => g().sections.splice(s + 1, 0, clone(g().sections[s])), sel.section(s + 1)),
    'section-delete': ({ s }) => api.change(() => g().sections.splice(s, 1)),
    'add-task': addTask('task'),
    'add-milestone': addTask('milestone'),
    'add-deadline': addTask('deadline'),
    'task-up': ({ s, t }) => api.change(() => move(g().sections[s].tasks, t, -1)),
    'task-down': ({ s, t }) => api.change(() => move(g().sections[s].tasks, t, 1)),
    'task-dup': ({ s, t }) => api.change(() => g().sections[s].tasks.splice(t + 1, 0, clone(g().sections[s].tasks[t])), sel.task(s, t + 1)),
    'task-delete': ({ s, t }) => api.change(() => g().sections[s].tasks.splice(t, 1)),
  };

  // ------------------------------------------------------------------ events

  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-gaction]');
    if (btn) actions[btn.dataset.gaction]?.(locate(btn));
  });

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    const field = el.dataset.gfield;
    if (el.tagName !== 'TEXTAREA' || !field) return;
    autosize(el);
    api.snapshotTyping();
    const { s, t } = locate(el);
    if (field === 'section') g().sections[s].name = el.value;
    else if (field === 'name') g().sections[s].tasks[t].name = el.value;
    api.update();
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.gopt) {
      api.snapshot();
      g()[el.dataset.gopt] = el.checked;
      api.update();
      return;
    }
    const field = el.dataset.gfield;
    if (!field || el.tagName === 'TEXTAREA') return;
    const { s, t } = locate(el);
    const task = g().sections[s].tasks[t];
    const cal = calendarOf(g());
    api.change(() => {
      if (field === 'type') {
        task.type = el.value;
        if (task.type !== 'task') task.from = task.to;
      } else if (field === 'status') {
        task.status = el.value;
      } else if (field === 'from' || field === 'to') {
        if (el.value === 'date') {
          const d = resolveRef(task[field], field === 'from' ? 'start' : 'end', cal) ?? new Date();
          task[field] = isoDate(d);
        } else {
          task[field] = el.value;
        }
        if (task.type !== 'task') task.from = task.to;
      } else if (field === 'from-date' || field === 'to-date') {
        if (!el.value) return;
        const key = field.slice(0, -5);
        task[key] = el.value;
        if (task.type !== 'task') task.from = task.to;
      }
    });
  });

  /** Enter in a task name adds the next task; Shift+Enter is ignored (single line). */
  root.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key !== 'Enter' || ev.isComposing || el.tagName !== 'TEXTAREA') return;
    ev.preventDefault();
    const { s, t } = locate(el);
    const sec = g().sections[s];
    if (el.dataset.gfield === 'section') {
      if (sec.tasks.length) root.querySelector(sel.task(s, 0))?.focus();
      else addTask('task')({ s });
    } else {
      const type = sec.tasks[t].type;
      api.change(() => sec.tasks.splice(t + 1, 0, nextTask({ tasks: sec.tasks.slice(0, t + 1) }, type)), sel.task(s, t + 1));
    }
  });

  return { render, autosizeAll: () => root.querySelectorAll('textarea').forEach(autosize) };
}
