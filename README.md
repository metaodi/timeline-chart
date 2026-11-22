# timeline-chart

A small, client-only web app to build [Mermaid timeline](https://mermaid.js.org/syntax/timeline.html) diagrams for
software delivery – sprints, Program Increments (PIs), release trains and milestones – without writing Mermaid by hand.
Diagrams are rendered with [Pele](https://pele.run), a fast, lightweight Mermaid renderer.

- **Form-based editor**: sections (PI, quarter…) → periods (sprint, month…) → items (stories, releases…)
- **Live preview** rendered by Pele, horizontal (`LR`) or vertical (`TD`), with colour presets
- **Responsive diagrams**: the preview re-lays out to the available width; on narrow screens a wide horizontal
  timeline switches to vertical automatically (toggle "Responsive"). Pinch/scroll zoom is built in.
- **Two chart types**: *Timeline* (periods with items) and *Gantt* (bars that span several sprints)
- **Sprint / PI generator**: start date, sprint length, sprints per PI, optional IP iteration, date labels
- **Milestones & deadlines**: every item/period has a type (🏁 milestone, ⏰ deadline, 🚀 release, ⚠️ risk, ✅ done)
- **Export**: download PNG or SVG (optionally transparent), copy the Mermaid code
- **Import** existing Mermaid timeline code, **share links** (the whole timeline is stored in the URL), autosave in the browser, undo/redo
- Works on desktop and mobile (on phones the app switches to Edit / Preview / Code tabs)

No build step and no dependencies: plain HTML, CSS and ES modules. Pele (core + the timeline diagram only) is loaded
from jsDelivr. Exports are rendered separately at natural size, so a PNG saved on a phone is not squeezed.

## Gantt mode

For work that spans several sprints. Switch with **Timeline | Gantt** at the top of the editor; each mode keeps its own
data.

- **No date juggling**: you give at most one date – when the plan starts (defaults to next Monday). Every bar has a
  **duration** (*sprints*, *weeks* or *working days*) and starts **after the previous bar** of its section. Optionally a
  bar starts at the plan start, at a sprint, **after another task** (dependency) or on an exact date, or runs *until* a
  sprint/date. The editor shows the computed dates under each bar.
- **PIs & sprints**: *Generate…* creates them from settings (sprint length, number of sprints, sprints per PI, IP
  iteration, sprint numbers continuing or **starting again at 1 in every PI**). Afterwards every PI and sprint is
  editable in the *PIs & sprints* list: rename, change a sprint's length in weeks, add, delete, reorder (a sprint moved
  past the edge of a PI moves into the neighbouring PI). A PI without a name holds sprints that belong to no PI.
  Sprint dates follow from the plan start and the sprint lengths.
- The chart shows a **PI row** and a **Sprint row** with all sprints side by side (`displayMode: compact`, no
  "staircase").
- **Sections** (teams, epics, workstreams) contain **bars**, **milestones** ◆ and **deadlines** (vertical line).
- **Status**: planned, in progress (outlined), done (faded), critical (red).
- Change a duration or the plan start and everything that follows moves with it.
- **Width**: the chart width grows with the plan (about 40px per week, 1000–4000px, Mermaid `useWidth`). On desktop
  the preview shows it at full width and scrolls horizontally; **⤢ Wide** hides the editor so the chart can use the
  whole window. On phones it scales down (zoom for details).
- **Colours**: PIs are black and sprints grey (in dark themes: light), so colour is left to the sections. Each section
  (e.g. a category of work) has its own colour: automatic (never red, which means *critical*) or chosen with the
  colour dot in the section header.

The generated Mermaid code is a standard `gantt` chart with concrete dates, so it renders the same everywhere. The
settings and the edited PIs/sprints are stored as `%% sprint-calendar …` / `%% sprint-plan …` comments: importing the
code restores them and the sprint references, but durations
and "after" rules come back as fixed sprints/dates. Share links and the browser autosave keep the full plan.

## Run locally

```sh
npm start          # python3 -m http.server 8000, then open http://localhost:8000
npm test           # unit tests (Node ≥ 20, no install needed)
```

Any static file server works; ES modules just need to be served over HTTP rather than opened as `file://`.

## Keyboard

| Key | In an item / period |
| --- | --- |
| <kbd>Enter</kbd> | add the next item |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | line break (written as `<br>`) |
| <kbd>Backspace</kbd> on an empty item | delete it |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, +<kbd>Shift</kbd> | undo / redo |

## Supported Mermaid timeline syntax

```
---
config:
  theme: forest            # default | neutral | dark | forest | base
  timeline:
    disableMulticolor: true
---
timeline TD                # or "timeline" / "timeline LR"
  title My timeline
  accTitle: Accessible title
  accDescr: Accessible description
  2024 : Period without a section
  section PI 1 <br> 5 Jan – 13 Mar
    Sprint 1 : Item A : Item B
             : Item C      # continuation line adds more items to Sprint 1
```

Characters that would break the grammar are escaped automatically (`#` → `#35;`, `: ` → `#58;`).

Themes: Pele styles diagrams with CSS variables, so the theme menu applies colour presets (`js/themes.js`) to the
preview and bakes them into SVG/PNG exports. On SVG export every `var(...)` is replaced by its concrete colour and the
background is a real rectangle (`js/svg-vars.js`), so the file looks the same in programs without CSS-variable support
(Inkscape, Illustrator, PowerPoint, …). The matching Mermaid theme name is written into the code's frontmatter so the
diagram looks similar in other Mermaid tools.

Mermaid has no native milestone/deadline concept in timelines, so item types are stored as an emoji prefix
(e.g. `🏁 Go-live`). That keeps them visible in the chart and lets them survive copy & import.

## Project structure

```
index.html          markup, dialogs
css/style.css       layout (desktop two-column, phone tabs), light/dark
js/model.js         data model, item types, Mermaid serialisation   ← start here to extend the syntax
js/parser.js        Mermaid code → model (import)
js/generator.js     sprint / PI calendar and timeline generator
js/gantt.js         Gantt model, Mermaid serialisation and import
js/gantt-editor.js  Gantt editor UI
js/gantt-style.js   colours Gantt bars like the timeline, shortens overflowing labels
js/examples.js      built-in examples (add your own)
js/themes.js        Pele colour presets (CSS variables)
js/export.js        SVG / PNG download, clipboard
js/svg-vars.js      resolves CSS variables to concrete colours for SVG export
js/storage.js       localStorage autosave, share-link encoding
js/app.js           UI wiring
test/               node:test unit tests
```

Typical extensions:

- **New item type** – add an entry to `KINDS` in `js/model.js`.
- **New colour theme** – add a preset to `PRESETS` in `js/themes.js` and its id to `THEMES` in `js/model.js`.
- **New example / template** – add a string to `EXAMPLES` in `js/examples.js`.
- **New diagram option** – add a field in `emptyTimeline()` / `normalize()`, write it in `toMermaid()`, read it in
  `parseMermaid()`, and add a control in `index.html` + `bindSettings()`.

## Deployment

`.github/workflows/deploy.yml` runs the tests on every push and pull request and deploys the static files to
**GitHub Pages** on pushes to `main`.

One-time setup: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
