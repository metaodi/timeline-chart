// Pele renders Mermaid syntax to SVG (https://pele.run). Only the timeline and gantt diagrams are loaded.
import { register, render, mount } from 'https://cdn.jsdelivr.net/npm/pele@1.13.0/dist/esm/core.js';
import timeline from 'https://cdn.jsdelivr.net/npm/pele@1.13.0/dist/esm/diagrams/timeline.js';
import gantt from 'https://cdn.jsdelivr.net/npm/pele@1.13.0/dist/esm/diagrams/gantt.js';
import { createGanttEditor } from './gantt-editor.js';
import { styleGantt } from './gantt-style.js';
import { peleCss } from './pele-css.js';
import { emptyGantt, newGanttSection } from './gantt.js';
import { toMermaid, normalize, isEmpty, newPeriod, newSection, THEMES, KINDS, getKind, stripKind, setKind } from './model.js';
import { parseMermaid } from './parser.js';
import { generateSprints, sprintPlanFromConfig } from './generator.js';
import { EXAMPLES, DEFAULT_EXAMPLE, GANTT_EXAMPLE, nextMonday as nextMondayIso } from './examples.js';
import { downloadSvg, downloadPng, copyText } from './export.js';
import { PRESETS, themeVars, applyVars } from './themes.js';
import { loadLocal, saveLocal, encodeShare, decodeShare } from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
let ganttEditor = null; // created in boot()
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// State + undo history
// ---------------------------------------------------------------------------

/** An example's app state: Mermaid code is parsed, functions build a state directly. */
const exampleState = (name) => {
  const ex = EXAMPLES[name];
  return typeof ex === 'function' ? ex() : parseMermaid(ex).timeline;
};

let state = normalize(exampleState(DEFAULT_EXAMPLE));
const past = [];
const future = [];
let typingBurst = null;

function snapshot() {
  const s = JSON.stringify(state);
  if (past[past.length - 1] !== s) past.push(s);
  if (past.length > 100) past.shift();
  future.length = 0;
  updateHistoryButtons();
}

/** Record history once per burst of typing instead of on every keystroke. */
function snapshotTyping() {
  if (!typingBurst) snapshot();
  clearTimeout(typingBurst);
  typingBurst = setTimeout(() => (typingBurst = null), 800);
}

function undo() {
  if (!past.length) return;
  future.push(JSON.stringify(state));
  state = JSON.parse(past.pop());
  refreshAll();
}

function redo() {
  if (!future.length) return;
  past.push(JSON.stringify(state));
  state = JSON.parse(future.pop());
  refreshAll();
}

function updateHistoryButtons() {
  $('#undo').disabled = past.length === 0;
  $('#redo').disabled = future.length === 0;
}

/** Apply a structural change: snapshot, mutate, re-render the editor. */
function change(mutator, focusSelector) {
  snapshot();
  mutator(state);
  renderEditor();
  update();
  if (focusSelector) {
    const el = $(focusSelector);
    if (el) {
      el.focus();
      if (el.tagName === 'INPUT' && el.type === 'text') el.select();
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

// ---------------------------------------------------------------------------
// Editor tree
// ---------------------------------------------------------------------------

const periodsOf = (g) => (g === 'u' ? state.periods : state.sections[Number(g)].periods);

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const iconBtn = (action, label, glyph, extra = '') =>
  `<button type="button" class="ibtn ${extra}" data-action="${action}" title="${label}" aria-label="${label}">${glyph}</button>`;

const kindIcon = (id) => KINDS.find((k) => k.id === id)?.icon || '•';

/** Native <select> (good on touch devices) laid invisibly over an icon. */
function kindSelect(text, label) {
  const current = getKind(text);
  return `<span class="kind" title="${label}"><span class="kind-icon" aria-hidden="true">${kindIcon(current)}</span><select data-kind aria-label="${label}">${KINDS.map(
    (k) => `<option value="${k.id}"${k.id === current ? ' selected' : ''}>${k.icon || '•'} ${k.label}</option>`,
  ).join('')}</select></span>`;
}

function eventHtml(g, p, e, text) {
  return `<li class="event kind-${getKind(text)}" data-e="${e}">
    ${kindSelect(text, 'Item type')}
    <textarea rows="1" data-field="event" data-g="${g}" data-p="${p}" data-e="${e}" placeholder="Story, feature, milestone…">${esc(stripKind(text))}</textarea>
    <span class="tools">${iconBtn('event-up', 'Move up', '↑')}${iconBtn('event-down', 'Move down', '↓')}${iconBtn('event-delete', 'Delete item', '✕', 'del')}</span>
  </li>`;
}

function periodHtml(g, p, period) {
  return `<div class="period" data-p="${p}">
    <div class="period-head kind-${getKind(period.label)}">
      ${kindSelect(period.label, 'Period type')}
      <textarea rows="1" class="label" data-field="label" data-g="${g}" data-p="${p}" placeholder="Period, e.g. Sprint 1 / Jan / v1.2">${esc(stripKind(period.label))}</textarea>
      <span class="tools">${iconBtn('period-up', 'Move period up', '↑')}${iconBtn('period-down', 'Move period down', '↓')}${iconBtn('period-dup', 'Duplicate period', '⧉')}${iconBtn('period-delete', 'Delete period', '✕', 'del')}</span>
    </div>
    <ul class="events">${period.events.map((e, i) => eventHtml(g, p, i, e)).join('')}</ul>
    <button type="button" class="add-event" data-action="add-event">+ Item</button>
  </div>`;
}

function groupHtml(g, title, periods, isSection) {
  const head = isSection
    ? `<div class="group-head">
        <textarea rows="1" class="section-name" data-field="section" data-g="${g}" placeholder="Section, e.g. PI 2026.1 / Q1">${esc(title)}</textarea>
        <span class="tools">${iconBtn('section-up', 'Move section up', '↑')}${iconBtn('section-down', 'Move section down', '↓')}${iconBtn('section-dup', 'Duplicate section', '⧉')}${iconBtn('section-delete', 'Delete section', '✕', 'del')}</span>
      </div>`
    : `<div class="group-head"><strong class="group-title">Without section</strong>
        <span class="muted small">Shown before all sections</span></div>`;
  return `<div class="group card ${isSection ? 'section' : 'ungrouped'}" data-g="${g}">
    ${head}
    <div class="periods">${periods.map((p, i) => periodHtml(g, i, p)).join('')}</div>
    <button type="button" class="btn small" data-action="add-period">+ Period (sprint, month…)</button>
  </div>`;
}

function renderEditor() {
  if (state.mode === 'gantt') ganttEditor.render();
  else renderTree();
}

function renderTree() {
  const parts = [];
  if (state.periods.length) parts.push(groupHtml('u', '', state.periods, false));
  state.sections.forEach((s, i) => parts.push(groupHtml(String(i), s.name, s.periods, true)));
  if (!parts.length) parts.push('<p class="empty card">Start with a section (e.g. a PI) or use <b>⚙︎ Sprints / PIs</b> to generate a sprint calendar.</p>');
  $('#tree').innerHTML = parts.join('');
  $$('#tree textarea').forEach(autosize);
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function locate(el) {
  const g = el.closest('[data-g]')?.dataset.g;
  const p = el.closest('[data-p]')?.dataset.p;
  const e = el.closest('[data-e]')?.dataset.e;
  return { g, p: p === undefined ? undefined : Number(p), e: e === undefined ? undefined : Number(e) };
}

function move(arr, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const sel = {
  section: (g) => `[data-field="section"][data-g="${g}"]`,
  label: (g, p) => `[data-field="label"][data-g="${g}"][data-p="${p}"]`,
  event: (g, p, e) => `[data-field="event"][data-g="${g}"][data-p="${p}"][data-e="${e}"]`,
};

const actions = {
  'add-section': () => {
    const g = state.sections.length;
    change((s) => s.sections.push(newSection()), sel.section(g));
  },
  'add-ungrouped': () => {
    const p = state.periods.length;
    change((s) => s.periods.push(newPeriod()), sel.label('u', p));
  },
  'section-up': ({ g }) => change((s) => move(s.sections, Number(g), -1)),
  'section-down': ({ g }) => change((s) => move(s.sections, Number(g), 1)),
  'section-dup': ({ g }) => change((s) => s.sections.splice(Number(g) + 1, 0, clone(s.sections[g])), sel.section(Number(g) + 1)),
  'section-delete': ({ g }) => change((s) => s.sections.splice(Number(g), 1)),
  'add-period': ({ g }) => {
    const p = periodsOf(g).length;
    change(() => periodsOf(g).push(newPeriod()), sel.label(g, p));
  },
  'period-up': ({ g, p }) => change(() => move(periodsOf(g), p, -1)),
  'period-down': ({ g, p }) => change(() => move(periodsOf(g), p, 1)),
  'period-dup': ({ g, p }) => change(() => periodsOf(g).splice(p + 1, 0, clone(periodsOf(g)[p])), sel.label(g, p + 1)),
  'period-delete': ({ g, p }) => change(() => periodsOf(g).splice(p, 1)),
  'add-event': ({ g, p }) => {
    const e = periodsOf(g)[p].events.length;
    change(() => periodsOf(g)[p].events.push(''), sel.event(g, p, e));
  },
  'event-up': ({ g, p, e }) => change(() => move(periodsOf(g)[p].events, e, -1)),
  'event-down': ({ g, p, e }) => change(() => move(periodsOf(g)[p].events, e, 1)),
  'event-delete': ({ g, p, e }) => change(() => periodsOf(g)[p].events.splice(e, 1)),
};

function onAction(ev) {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  actions[btn.dataset.action]?.(locate(btn));
}

function onTreeInput(ev) {
  const ta = ev.target;
  const field = ta.dataset.field;
  if (!field) return;
  autosize(ta);
  snapshotTyping();
  const { g, p, e } = locate(ta);
  const kind = ta.closest('.event, .period-head')?.querySelector('[data-kind]')?.value;
  if (field === 'section') state.sections[Number(g)].name = ta.value;
  else if (field === 'label') periodsOf(g)[p].label = setKind(ta.value, kind);
  else if (field === 'event') periodsOf(g)[p].events[e] = setKind(ta.value, kind);
  update();
}

/** Changing an item type re-applies the emoji prefix to the text. */
function onTreeChange(ev) {
  const select = ev.target;
  if (!select.matches('[data-kind]')) return;
  const row = select.closest('.event, .period-head');
  const ta = row.querySelector('textarea');
  const { g, p, e } = locate(ta);
  snapshot();
  if (ta.dataset.field === 'label') periodsOf(g)[p].label = setKind(ta.value, select.value);
  else periodsOf(g)[p].events[e] = setKind(ta.value, select.value);
  row.className = row.className.replace(/\bkind-\S+/, `kind-${select.value}`);
  row.querySelector('.kind-icon').textContent = kindIcon(select.value);
  update();
}

/** Enter = next item, Shift+Enter = line break, Backspace on empty item = delete it. */
function onTreeKeydown(ev) {
  const ta = ev.target;
  const field = ta.dataset?.field;
  if (!field || ev.isComposing) return;
  const { g, p, e } = locate(ta);
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    if (field === 'section') {
      if (!periodsOf(g).length) actions['add-period']({ g });
      else $(sel.label(g, 0))?.focus();
    } else if (field === 'label') {
      change(() => periodsOf(g)[p].events.splice(0, 0, ''), sel.event(g, p, 0));
    } else if (field === 'event') {
      change(() => periodsOf(g)[p].events.splice(e + 1, 0, ''), sel.event(g, p, e + 1));
    }
  } else if (ev.key === 'Backspace' && field === 'event' && ta.value === '') {
    ev.preventDefault();
    const target = e > 0 ? sel.event(g, p, e - 1) : sel.label(g, p);
    change(() => periodsOf(g)[p].events.splice(e, 1), target);
  }
}

// ---------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------

function renderSettings() {
  document.body.dataset.mode = state.mode;
  $$('input[name="mode"]').forEach((r) => (r.checked = r.value === state.mode));
  $('#title').value = state.title;
  $$('input[name="direction"]').forEach((r) => (r.checked = r.value === state.direction));
  $('#theme').value = state.theme;
  $('#multicolor').checked = !state.disableMulticolor;
  $('#accTitle').value = state.accTitle;
  $('#accDescr').value = state.accDescr;
}

function bindSettings() {
  $('#theme').innerHTML = THEMES.map((t) => `<option value="${t}">${PRESETS[t]?.label ?? t}</option>`).join('');
  const onText = (key) => (ev) => {
    snapshotTyping();
    state[key] = ev.target.value;
    update();
  };
  $('#title').addEventListener('input', onText('title'));
  $('#accTitle').addEventListener('input', onText('accTitle'));
  $('#accDescr').addEventListener('input', onText('accDescr'));
  $$('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      snapshot();
      state.mode = r.value;
      // First visit to Gantt mode: start from the example roadmap.
      if (state.mode === 'gantt' && !state.gantt.sections.length && !state.gantt.calendar.startDate) {
        state.gantt = normalize(exampleState(GANTT_EXAMPLE)).gantt;
      }
      refreshAll();
    }),
  );
  $$('input[name="direction"]').forEach((r) =>
    r.addEventListener('change', () => {
      snapshot();
      state.direction = r.value;
      update();
    }),
  );
  $('#theme').addEventListener('change', (ev) => {
    snapshot();
    state.theme = ev.target.value;
    update();
  });
  $('#multicolor').addEventListener('change', (ev) => {
    snapshot();
    state.disableMulticolor = !ev.target.checked;
    update();
  });
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

register(timeline, gantt);

let renderTimer = null;
let currentCode = '';
let mounted = null; // Pele mount: re-lays out the diagram whenever the preview resizes

/** Code pane: Mermaid code or CSS for the Pele playground. */
let codeTab = 'mermaid';
let insideLabels = new Set(); // gantt task ids with labels on the bar (last preview layout)
function showCode() {
  const css = codeTab === 'css';
  $('#code').textContent = css ? peleCss(state, insideLabels) : currentCode;
  $('#copy-code').textContent = css ? 'Copy CSS' : 'Copy code';
  $$('.code-tabs [data-code]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.code === codeTab)));
}

function update() {
  currentCode = toMermaid(state);
  showCode();
  saveLocal(state);
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 120);
  updateHistoryButtons();
}

function previewOptions() {
  return {
    // On narrow screens Pele switches a too-wide horizontal timeline to vertical.
    autoDirection: state.mode === 'timeline' && $('#responsive').checked,
    // Gantt: always lay out at the chart's own width (useWidth in the code). On
    // desktop it scrolls horizontally, on phones it scales down (zoom for details).
    ...(state.mode === 'gantt' ? { maxWidth: 4000 } : {}),
    zoom: 'auto',
    onError: showError,
    // Runs after every (re-)layout, including resizes.
    onRender: () => {
      insideLabels = styleGantt($('#preview svg.pele'), state);
      if (codeTab === 'css') showCode(); // the CSS depends on the layout (labels on bars)
    },
  };
}

function showError(err) {
  const where = err?.line ? `Line ${err.line}: ` : '';
  $('#error').textContent = `Could not render this timeline. ${where}${err?.message || err}`;
  $('#error').hidden = false;
}

function renderPreview() {
  const preview = $('#preview');
  $('#error').hidden = true;
  applyVars(preview, themeVars(state.theme, state.disableMulticolor));
  if (isEmpty(state)) {
    mounted?.destroy();
    mounted = null;
    preview.innerHTML = '<p class="muted placeholder">Add a period to see the timeline.</p>';
    return;
  }
  const code = previewCode();
  if (!mounted) {
    preview.innerHTML = '';
    mounted = mount(preview, code, previewOptions());
  } else {
    mounted.update(code, previewOptions());
  }
}

/** On desktop a Gantt chart fills at least the preview width (e.g. in the wide view). */
function previewCode() {
  if (state.mode !== 'gantt' || matchMedia('(max-width: 720px)').matches) return currentCode;
  const available = $('#preview').clientWidth - 34;
  return currentCode.replace(/useWidth: (\d+)/, (_, w) => `useWidth: ${Math.max(Number(w), available)}`);
}

/**
 * Exports are rendered separately at natural size (not squeezed to the
 * preview width) with the theme's colours written into the SVG.
 */
function exportSvg() {
  if (isEmpty(state)) {
    toast('Nothing to export yet');
    return null;
  }
  try {
    const { svg } = render(currentCode, { padding: 16 });
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const vars = themeVars(state.theme, state.disableMulticolor);
    applyVars(el, vars);
    styleGantt(el, state);
    const background = $('#transparent').checked ? null : vars['--pele-bg'];
    return { el, background };
  } catch (err) {
    showError(err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Misc UI: toast, views (mobile tabs), dialogs
// ---------------------------------------------------------------------------

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function setView(view) {
  $('.layout').dataset.view = view;
  $$('.tabbar button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.view === view));
  if (view === 'edit') $$('#tree textarea').forEach(autosize);
  window.scrollTo({ top: 0 });
}

/** Load a timeline or gantt chart; the data of the other mode is kept. */
function loadTimeline(t) {
  snapshot();
  const next = normalize(t);
  if (next.mode === 'gantt') {
    next.periods = state.periods;
    next.sections = state.sections;
    next.direction = state.direction;
  } else {
    next.gantt = state.gantt;
  }
  state = next;
  refreshAll();
}

function refreshAll() {
  renderSettings();
  renderEditor();
  update();
}

function bindDialogs() {
  // Import
  const imp = $('#import-dialog');
  $('#open-import').addEventListener('click', () => {
    $('#import-text').value = '';
    $('#import-warnings').hidden = true;
    imp.showModal();
    $('#import-text').focus();
  });
  $('#import-ok').addEventListener('click', (ev) => {
    const { timeline, warnings } = parseMermaid($('#import-text').value);
    if (isEmpty(timeline) && warnings.length) {
      ev.preventDefault();
      $('#import-warnings').textContent = warnings.join('\n');
      $('#import-warnings').hidden = false;
      return;
    }
    loadTimeline(timeline);
    toast(warnings.length ? `Imported with ${warnings.length} warning(s)` : 'Imported');
  });

  // Generator
  const gen = $('#gen-dialog');
  const form = $('#gen-form');
  const calendarFields = ['startDate', 'sprintWeeks', 'sprintCount', 'sprintsPerPI', 'firstSprint', 'firstPI', 'sprintPrefix', 'piPrefix'];
  openGenerator = () => {
    const isGantt = state.mode === 'gantt';
    $('#gen-title').textContent = isGantt ? 'Generate PIs & sprints' : 'Generate sprints & PIs';
    $('#gen-ok').textContent = isGantt ? 'Replace PIs & sprints' : 'Generate';
    if (isGantt) {
      const c = state.gantt.calendar;
      calendarFields.forEach((k) => (form[k].value = c[k] ?? ''));
      form.ipIteration.checked = Boolean(c.ipIteration);
      form.restartNumbering.checked = Boolean(c.restartNumbering);
    }
    if (!form.startDate.value) form.startDate.value = nextMonday();
    form.insert.value = isEmpty(state) ? 'replace' : 'append';
    gen.showModal();
  };
  $('#open-generator').addEventListener('click', () => openGenerator());
  form.addEventListener('submit', (ev) => {
    if (ev.submitter?.value !== 'ok') return;
    const f = new FormData(form);
    if (state.mode === 'gantt') {
      change((s) => {
        const c = s.gantt.calendar;
        calendarFields.forEach((k) => (c[k] = f.get(k)));
        ['sprintWeeks', 'sprintCount', 'sprintsPerPI', 'firstSprint'].forEach((k) => (c[k] = Number(c[k])));
        c.ipIteration = f.get('ipIteration') === 'on';
        c.restartNumbering = f.get('restartNumbering') === 'on';
        // (Re)generate the editable PI / sprint list from the settings
        s.gantt.pis = sprintPlanFromConfig(c);
      });
      toast('PIs and sprints generated – undo to go back');
      return;
    }
    const sections = generateSprints({
      startDate: f.get('startDate'),
      sprintWeeks: Number(f.get('sprintWeeks')),
      sprintCount: Number(f.get('sprintCount')),
      sprintsPerPI: Number(f.get('sprintsPerPI')),
      firstSprint: Number(f.get('firstSprint')),
      firstPI: f.get('firstPI'),
      sprintPrefix: f.get('sprintPrefix') || 'Sprint',
      piPrefix: f.get('piPrefix') || 'PI',
      dateStyle: f.get('dateStyle'),
      ipIteration: f.get('ipIteration') === 'on',
      restartNumbering: f.get('restartNumbering') === 'on',
    });
    change((s) => {
      if (f.get('insert') === 'replace') {
        s.sections = sections;
        s.periods = [];
      } else {
        s.sections.push(...sections);
      }
    });
    toast(`Generated ${sections.length} section(s)`);
  });

  // Close dialogs when clicking the backdrop
  for (const d of [imp, gen]) {
    d.addEventListener('click', (ev) => {
      if (ev.target === d) d.close();
    });
  }
}

let openGenerator = () => {};

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bindToolbar() {
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  document.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'z' || $('dialog[open]')) return;
    ev.preventDefault();
    ev.shiftKey ? redo() : undo();
  });

  const ex = $('#examples');
  ex.insertAdjacentHTML('beforeend', Object.keys(EXAMPLES).map((k) => `<option>${esc(k)}</option>`).join(''));
  ex.addEventListener('change', () => {
    if (!ex.value) return;
    loadTimeline(exampleState(ex.value));
    ex.value = '';
    toast('Example loaded – undo to go back');
  });

  $('#clear').addEventListener('click', () => {
    if (state.mode === 'gantt') {
      const g = { ...emptyGantt(), calendar: { ...state.gantt.calendar } };
      if (!g.calendar.startDate) g.calendar.startDate = nextMondayIso();
      g.sections = [newGanttSection()];
      loadTimeline({ ...state, title: '', mode: 'gantt', gantt: g });
      toast('New Gantt chart – undo to go back');
    } else {
      loadTimeline({ ...state, title: '', mode: 'timeline', periods: [], sections: [newSection()] });
      toast('New timeline – undo to go back');
      $(sel.section(0))?.focus();
    }
  });

  $('#share').addEventListener('click', async () => {
    try {
      const url = `${location.origin}${location.pathname}#c=${await encodeShare(state)}`;
      history.replaceState(null, '', url);
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: state.title || 'Timeline', url });
      } else {
        await copyText(url);
        toast('Share link copied');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Could not create share link');
    }
  });

  $$('.code-tabs [data-code]').forEach((tab) =>
    tab.addEventListener('click', () => {
      codeTab = tab.dataset.code;
      showCode();
    }),
  );
  $('#copy-code').addEventListener('click', async () => {
    try {
      const css = codeTab === 'css';
      await copyText(css ? peleCss(state, insideLabels) : currentCode);
      toast(css ? 'Pele CSS copied – paste it into the CSS tab of the playground' : 'Mermaid code copied');
    } catch {
      toast('Copy failed – select the code manually');
    }
  });
  $('#dl-svg').addEventListener('click', () => {
    const out = exportSvg();
    if (out) downloadSvg(out.el, state.title, out.background);
  });
  $('#dl-png').addEventListener('click', async () => {
    const out = exportSvg();
    if (!out) return;
    try {
      await downloadPng(out.el, state.title, out.background);
    } catch (err) {
      toast(err.message);
    }
  });
  $('#responsive').addEventListener('change', renderPreview);
  // Wide view: hide the editor so the chart can use the full width.
  const setWide = (on) => {
    document.body.classList.toggle('wide', on);
    $('#wide').setAttribute('aria-pressed', String(on));
    $('#wide').textContent = on ? '⤡ Editor' : '⤢ Wide';
    if (currentCode) renderPreview();
    try {
      localStorage.setItem('timeline-builder:wide', on ? '1' : '');
    } catch {
      /* optional */
    }
  };
  $('#wide').addEventListener('click', () => setWide(!document.body.classList.contains('wide')));
  try {
    if (localStorage.getItem('timeline-builder:wide')) setWide(true);
  } catch {
    /* optional */
  }

  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  const hash = location.hash.match(/^#c=(.+)$/);
  if (hash) {
    try {
      state = normalize(await decodeShare(hash[1]));
    } catch {
      toast('Share link is invalid');
    }
  } else {
    const saved = loadLocal();
    if (saved) state = normalize(saved);
  }
  ganttEditor = createGanttEditor($('#gantt-editor'), {
    getState: () => state,
    change,
    snapshot,
    snapshotTyping,
    update,
    openCalendar: () => openGenerator(),
  });
  bindSettings();
  bindToolbar();
  bindDialogs();
  const tree = $('#tree');
  tree.addEventListener('input', onTreeInput);
  tree.addEventListener('keydown', onTreeKeydown);
  tree.addEventListener('change', onTreeChange);
  document.addEventListener('click', onAction);
  let resizeTimer;
  window.addEventListener('resize', () => {
    $$('#tree textarea, #gantt-editor textarea').forEach(autosize);
    // a Gantt chart fills the preview width, so lay it out again
    clearTimeout(resizeTimer);
    if (state.mode === 'gantt') resizeTimer = setTimeout(renderPreview, 200);
  });
  refreshAll();
}

boot();
