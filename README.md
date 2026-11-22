# timeline-chart

A small, client-only web app to build [Mermaid timeline](https://mermaid.js.org/syntax/timeline.html) diagrams for
software delivery – sprints, Program Increments (PIs), release trains and milestones – without writing Mermaid by hand.

- **Form-based editor**: sections (PI, quarter…) → periods (sprint, month…) → items (stories, releases…)
- **Live preview** rendered by Mermaid, horizontal (`LR`) or vertical (`TD`), with Mermaid themes
- **Sprint / PI generator**: start date, sprint length, sprints per PI, optional IP iteration, date labels
- **Milestones & deadlines**: every item/period has a type (🏁 milestone, ⏰ deadline, 🚀 release, ⚠️ risk, ✅ done)
- **Export**: download PNG or SVG (optionally transparent), copy the Mermaid code
- **Import** existing Mermaid timeline code, **share links** (the whole timeline is stored in the URL), autosave in the browser, undo/redo
- Works on desktop and mobile (on phones the app switches to Edit / Preview / Code tabs)

No build step and no dependencies: plain HTML, CSS and ES modules. Mermaid is loaded from jsDelivr.

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

Mermaid has no native milestone/deadline concept in timelines, so item types are stored as an emoji prefix
(e.g. `🏁 Go-live`). That keeps them visible in the chart and lets them survive copy & import.

**Known Mermaid limitation:** in vertical (`TD`) mode Mermaid can draw a section header over the last item of the
previous section when that period has several items. Horizontal mode is not affected.

## Project structure

```
index.html          markup, dialogs
css/style.css       layout (desktop two-column, phone tabs), light/dark
js/model.js         data model, item types, Mermaid serialisation   ← start here to extend the syntax
js/parser.js        Mermaid code → model (import)
js/generator.js     sprint / PI generator
js/examples.js      built-in examples (add your own)
js/export.js        SVG / PNG download, clipboard
js/storage.js       localStorage autosave, share-link encoding
js/app.js           UI wiring
test/               node:test unit tests
```

Typical extensions:

- **New item type** – add an entry to `KINDS` in `js/model.js`.
- **New example / template** – add a string to `EXAMPLES` in `js/examples.js`.
- **New diagram option** – add a field in `emptyTimeline()` / `normalize()`, write it in `toMermaid()`, read it in
  `parseMermaid()`, and add a control in `index.html` + `bindSettings()`.

## Deployment

`.github/workflows/deploy.yml` runs the tests on every push and pull request and deploys the static files to
**GitHub Pages** on pushes to `main`.

One-time setup: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
