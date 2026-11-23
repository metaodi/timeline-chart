# CLAUDE.md

Guidance for working on this repository. See `README.md` for the user-facing feature list.

## What this is

A **client-only** web app (no build step, no dependencies) to build Mermaid diagrams for software delivery planning:

- **Timeline mode** – Mermaid `timeline` (sections → periods → items).
- **Gantt mode** – Mermaid `gantt` with a sprint/PI calendar, tasks defined by durations, milestones, deadlines.

Diagrams are rendered with **[Pele](https://pele.run)** (a Mermaid renderer, npm `pele`), not Mermaid.js. Output:
live preview, PNG/SVG download, Mermaid code, CSS for the Pele playground, share links (state in the URL hash).

Deployed to GitHub Pages by `.github/workflows/deploy.yml` (tests on every push/PR, deploy on `main`).

## Commands

```sh
npm test     # node:test unit tests (Node ≥ 20, no install)
npm start    # python3 -m http.server 8000 – ES modules need http://, not file://
```

## Architecture

Plain ES modules in `js/`, one global app state (plain JSON) in `app.js`, re-rendered on change.

| File | Role |
| --- | --- |
| `app.js` | UI wiring, state + undo/redo, timeline editor, preview (Pele `mount`), exports, dialogs |
| `model.js` | state shape, `normalize()`, timeline → Mermaid, dispatches gantt to `gantt.js`; item kinds (emoji prefixes) |
| `parser.js` | Mermaid → state (timeline; delegates `gantt` to `gantt.js`) |
| `generator.js` | sprint/PI calendar: `sprintPlanFromConfig`, `calendarFromPlan`, timeline generator |
| `gantt.js` | gantt model, scheduling (`scheduleGantt`), Mermaid output, import, section colours, row presets |
| `gantt-editor.js` | gantt editor UI (plan card, PIs & sprints list, sections, tasks) |
| `gantt-collapse.js` | "In my order" layout: collapses PI/sprint rows of Pele's non-compact layout |
| `gantt-style.js` | colours bars per section, neutral PIs/sprints, statuses, row stripes, shortens labels |
| `gantt-notes.js` | tooltips, numbered notes below the chart, link markers |
| `svg-title.js` | left-aligned title |
| `svg-vars.js` | resolves CSS `var()` to concrete colours for SVG export |
| `themes.js` | colour presets (Pele CSS variables), `PELE_DEFAULTS`, row colour tokens |
| `pele-css.js` | CSS for the Pele playground's CSS tab |
| `export.js` / `storage.js` / `drag.js` | downloads + clipboard / autosave + share links / pointer-event drag & drop |
| `splitter.js` | draggable divider that resizes the editor column (`--editor-w` on `.layout`, kept in localStorage) |
| `embed.js` | full app state in exports (PNG `iTXt` chunk, SVG `<metadata id="timeline-builder">`) for a 1:1 restore |

### Rendering pipeline (order matters)

Preview (`renderPreview` → Pele `mount`, `onRender`) and export (`exportSvg` → fresh Pele `render`) run the **same**
post-processing on the SVG, in this order:

1. `collapseCalendarRows` (only gantt + layout `ordered`) – must run first, the others read positions
2. `styleGantt` – returns the ids of labels drawn on bars (used by `pele-css.js`)
3. `alignTitle`
4. `addNotes` – appends footnotes, grows the viewBox (preview then calls `mounted.zoom.refresh()`)

Export post-processes the SVG attached off screen (text widths are measured with `getComputedTextLength`). Export
additionally: `applyVars` (theme variables on the root) and, in `svgMarkup`, `inlineCssVars` + a background
`<rect>`. The PNG is rasterised at `state.pngSize` (`2x` density or `1920px` width, `pngScale()` in `export.js`,
capped at 16.7 megapixels / 16384px a side for iOS). On desktop the preview widens Gantt charts to at least the preview width (`previewCode()` raises
`useWidth`), and exports use the same `previewCode()` – the export is as wide as what the user sees (wide view
included). On phones both use the code's own width.

### Gantt data model (`state.gantt`)

- `calendar` – generator settings; `pis: [{id:'piN', name, sprints:[{id:'sN', name, weeks}]}]` – generated from the
  calendar, then edited freely. A PI with an empty name = sprints without PI. Dates follow from `calendar.startDate`
  and the sprint lengths.
- `sections: [{name, color, tasks}]`; task = `{id, name, type: task|milestone|deadline, status, from, duration, to,
  note, link, look, endDate}` – `look`: `''` | `hatch` | `option` (bars only, drawn by `gantt-style.js`); `endDate`:
  `''` | `show` | `hide` overrides the chart's `endDates` for this entry (`showsEndDate()`).
  - `from`: `prev` | `plan` | `after:<taskId>` | sprint id `sN` | `YYYY-MM-DD`
  - `duration`: `Ns` sprints / `Nw` weeks / `Nd` working days, or `''` = until `to` (sprint id or date)
  - milestones/deadlines: position in `from` (sprint → its end)
- `layout` (`compact` | `ordered`), `rows` (stripe tokens), `showPIs`, `showSprints`, `showNotes`, `endDates`
  (`''` | `all` | `some`: dot + date after bars/milestones; the chart's viewBox grows on the right to fit),
  `endDateFormat` (`dmy` | `iso`).
  `minWidth` / `maxWidth` (px, 0 = automatic 1000 / 4000; `widthRange()`): bounds for `useWidth` and for the
  desktop preview's widening (`previewCode()`); `%% chart-width <min|auto> <max|auto>`.
  `axisFormat` (strftime, `''` = `%d %b`) and `tickInterval` (`Nday|Nweek|Nmonth`, `''` = one per sprint): written as
  Mermaid `axisFormat` / `tickInterval`; on import a tick equal to the sprint length becomes `''` again.
- Task `id` (`t…`) is stable (for `after:` refs). **In the Mermaid code** tasks are `g<section>t<index>`, sprints `sN`,
  PIs `piN` – styling, notes, links and the playground CSS address elements by these `data-id`s.

### What lives in the Mermaid code

Concrete dates only (Mermaid can't express our scheduling). Everything Mermaid can't hold goes into `%%` comments
that the importer reads back: `%% sprint-calendar …`, `%% sprint-plan [json]`, `%% section-colours …`,
`%% row-colours …`, `%% notes {json}`, `%% task-looks {json}`, `%% end-dates <mode> <format>`, `%% end-date-tasks {json}`, `%% chart-width …`. App-only themes (e.g. `ebp`)
write the closest Mermaid theme plus a YAML comment `# timeline-builder theme: …` in the frontmatter. Links use standard `click <id> href "…"`. Layout = presence of
`displayMode: compact` in the frontmatter; `useWidth` sets the chart width. Durations/`after` rules come back as
fixed sprints/dates on import (share links, autosave and exported PNG/SVG files keep the full state).

### State in exported files

PNG/SVG downloads embed `{"app":"timeline-builder","v":1,"state":…}` (`embed.js`). `openFile()` in `app.js` (Import
dialog "Open file…" or drop on the page) restores it by **replacing the whole state** (both modes) with a
`snapshot()` for undo; other text files are parsed as Mermaid. When adding state fields, keep `normalize()` tolerant
so older files still load.

## Pele facts learned the hard way

- `mounted.update()` may skip re-rendering when only `%%` comments change (seen on phones, preview hidden) → the
  preview mounts again when the code differs only in comments (`renderPreview`).
- Pinned to `pele@1.13.0` from jsDelivr (`core.js` + only `diagrams/timeline.js` and `diagrams/gantt.js`).
- Themed **only by CSS variables** (`--pele-bg`, `--pele-fg`, `--pele-series-1..8`, …); it ignores Mermaid `theme` and
  `disableMulticolor`. All gantt bars use the accent colour → we recolour in `gantt-style.js`.
- `displayMode: compact` packs a section's entries into rows **sorted by start date** (editor order is lost).
  Without it every entry (also every sprint) gets its own row in source order.
- A milestone given as a range is drawn in the **middle** of the range. Compact mode uses this: milestones are written
  as label-wide ranges centred on the date so close milestones get separate rows (clamped to the chart span so the
  axis doesn't grow). Import reads the middle back.
- `useWidth` (frontmatter `gantt:`) sets the chart width; `maxWidth` render option clamps it.
- `mount()` re-lays out on resize and may switch timelines LR→TD on narrow screens (`autoDirection`). Its zoom caches the
  viewBox → call `mounted.zoom.refresh()` after changing the SVG size. `mounted.refresh()` does **not** re-render when
  only our post-processing changes (e.g. title alignment) → destroy and mount again.
- Labels: inside a solid bar → `fill` attribute; outside → no `fill`; "active" bars are light, their labels have no
  `fill` either (CSS can't tell inside/outside → `pele-css.js` uses the ids from `styleGantt`).
- In the preview, links are handled by `mount` (no `<a>`); in `render()` output the task is wrapped in `<a href>`.
  Unsafe schemes (`javascript:`) are filtered by Pele.
- Escape text for the grammar: timeline `#` → `#35;`, `: ` → `#58;`; gantt names `#:;` in **one pass**
  (`#${code};`), otherwise the inserted entities get escaped again.

## Conventions

- Keep the look clean ("ohne Schnickschnack"), close to the timeline diagram. No weekend shading, no today line.
- Must work on desktop **and** mobile: phone layout = Edit / Preview / Code tabs, 16px inputs (no iOS zoom), touch
  targets ≥ 34px, no horizontal overflow at 390px. Drag & drop uses pointer events (HTML5 DnD fails on iOS); handles
  need `touch-action: none`.
- Editor re-renders on structural changes; text inputs update state without re-rendering. Text/number/date inputs
  re-render on `change` **deferred** (`setTimeout`) and `render()` restores focus by data attributes.
- Undo: `snapshot()` before structural changes, `snapshotTyping()` for typing bursts.
- New feature → unit tests in `test/*.test.mjs` (pure functions; DOM code is tested in the browser).

## Verifying changes in a browser

The sandbox usually blocks `cdn.jsdelivr.net` and `pele.run`. Get Pele with `npm pack pele@1.13.0` into a scratch
directory and let Playwright serve the CDN URLs from it:

```js
await context.route('https://cdn.jsdelivr.net/npm/pele@1.13.0/**', (r) =>
  r.fulfill({ path: path.join(PKG, new URL(r.request().url()).pathname.replace('/npm/pele@1.13.0/', '')),
              contentType: 'text/javascript' }));
```

Check desktop (1440px) and `devices['iPhone 13']`, look at screenshots, assert no `pageerror` and
`scrollWidth === innerWidth`. Pitfalls: targets outside the scrolled editor column or under the sticky top bar
(56px) make mouse/touch tests fail; simulate touch with CDP `Input.dispatchTouchEvent`. To validate `pele-css.js`,
render raw Pele + the exported CSS and compare computed fills with the app preview (should be 0 differences).

## Workflow notes

- The user communicates in **German**; code, comments, README and commits are in English.
- Work on the session branch; one PR per feature. Merged PRs delete the branch – a later push recreates it. Force pushes
  are not allowed: merge `origin/main` into the branch instead of rebasing.
- End commit messages with the attribution lines required by the session.
