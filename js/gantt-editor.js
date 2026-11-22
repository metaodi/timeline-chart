/**
 * Editor UI for Gantt mode: plan start + sprint calendar, sections (teams,
 * epics…) and tasks defined by a start rule and a duration. Concrete dates are
 * computed by scheduleGantt() and shown under each task.
 */
import { TASK_TYPES, STATUSES, DURATION_UNITS, scheduleGantt, newTask, newGanttSection, newPlanSprint, newPlanPI } from './gantt.js';
import { formatDate, isoDate, nextName } from './generator.js';

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
    const when =
      task.type === 'task'
        ? `<label>Start ${startSelect(task, s, t, cal, planStart)}</label><label>Duration ${durationInputs(task, s, t, cal)}</label>`
        : `<label>On ${startSelect(task, s, t, cal, planStart)}</label>`;
    const placeholder = task.type === 'task' ? 'Feature, epic, story…' : task.type === 'milestone' ? 'Release, demo…' : 'Code freeze, deadline…';
    return `<li class="gtask type-${task.type} status-${task.status || 'planned'}" data-gt="${t}">
      <div class="gtask-head">
        ${typePicker}
        <textarea rows="1" data-gfield="name" data-gs="${s}" data-gt="${t}" placeholder="${placeholder}">${esc(task.name)}</textarea>
        <span class="tools">${iconBtn('task-up', 'Move up', '↑')}${iconBtn('task-down', 'Move down', '↓')}${iconBtn('task-dup', 'Duplicate', '⧉')}${iconBtn('task-delete', 'Delete', '✕', 'del')}</span>
      </div>
      <div class="gtask-when">${when}${status}</div>
      <div class="gtask-dates">${describe(sched.dates[s][t], task.type)}</div>
    </li>`;
  }

  let planOpen = false; // remember whether the PI/sprint list is expanded

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
      <div class="gcal-opts">${opt('showPIs', 'Show PIs')}${opt('showSprints', 'Show sprints')}</div>
    </div>`;
  }

  /** Selector for the focused field, so focus survives a re-render. */
  function focusKey() {
    const el = document.activeElement;
    if (!el || !root.contains(el)) return null;
    const attr = ['gpfield', 'gfield', 'gcal', 'gaction'].find((k) => el.dataset[k]);
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
        (sec, s) => `<div class="group card section" data-gs="${s}">
        <div class="group-head">
          <textarea rows="1" class="section-name" data-gfield="section" data-gs="${s}" placeholder="Team, epic, workstream…">${esc(sec.name)}</textarea>
          <span class="tools">${iconBtn('section-up', 'Move section up', '↑')}${iconBtn('section-down', 'Move section down', '↓')}${iconBtn('section-dup', 'Duplicate section', '⧉')}${iconBtn('section-delete', 'Delete section', '✕', 'del')}</span>
        </div>
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
        g().sections.splice(s + 1, 0, { name: sec.name, tasks: sec.tasks.map(copy) });
      }, sel.section(s + 1)),
    'section-delete': ({ s }) => api.change(() => g().sections.splice(s, 1)),
    'add-task': addTask('task'),
    'add-milestone': addTask('milestone'),
    'add-deadline': addTask('deadline'),
    'task-up': ({ s, t }) => api.change(() => move(g().sections[s].tasks, t, -1)),
    'task-down': ({ s, t }) => api.change(() => move(g().sections[s].tasks, t, 1)),
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
    if (btn) actions[btn.dataset.gaction]?.(locate(btn));
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
    if (ev.key !== 'Enter' || ev.isComposing || el.tagName !== 'TEXTAREA') return;
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

  return { render, autosizeAll: () => root.querySelectorAll('textarea').forEach(autosize) };
}
