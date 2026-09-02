# Changelog

## 0.6.1 - Unreleased

## 0.6.0 - 2 Sep 2026

- Add `dgbuild bundle [export-name]` - builds the web page (`out/web/` + zip) for a `dialog.json` export configuration headlessly, so a GitHub Action can publish a release
- Add `dgbuild new-skein [name]` / `dgbuild open-skein [name]` - create or open a skein and drive its full interactive browser UI with no VS Code; auto-opens a browser (`--no-open` to skip), with an in-UI Quit button that prompts to save when there are unsaved changes
- Fix the Trace panel indenting each nested level cumulatively more than the last, pushing deep traces far off the right edge

## 0.5.1 - 28 Aug 2026

- Fix the Skein and Trace views staying in light mode when VS Code is in a dark theme
- Fix opening a transcript knot's actions menu adding extra vertical space to that knot's response
- Fix nav graph connector lines showing through the collapse/expand toggle icon instead of being hidden behind it
- Fix nav graph connector arrows staying a fixed size when zoomed out instead of shrinking with the nodes
- Fix the Dynamic State toggle and nav graph marker-filter buttons only showing their button outline on hover instead of always looking like buttons
- Nav graph: each knot's actions menu is now only rendered when actually open, instead of every knot's full (invisible) menu on every patch - cut SSE patch size roughly 3x on a large tree (~554 knots: 3.4MB to 1.2MB), fixing sluggishness on trees of that size

## 0.5.0 - 25 Aug 2026

- Add `dgbuild`, a headless CLI (`test`, `run-skein`, `sources`) for running project checks from scripts/CI without the VS Code extension host

## 0.4.1 - 22 Aug 2026

- Fix `dialog.json`'s `binDir` being ignored when set to a relative path (e.g. `"bin"`) - it's now resolved against the project root like source entries, instead of the extension host's own working directory
- Fix a script-load race that could break the Skein/Trace webview on startup ("sk is not defined") - each page now loads a single `skein-loader.js`/`trace-loader.js` entry point whose static imports guarantee `main.js`/`trace.js` finish before `datastar.js` runs, instead of relying on `<script>` tag order

## 0.4.0 - 21 Aug 2026

- Nav graph: zoom in/out via mouse wheel (centered on the cursor) or new bottom-right +/- buttons
- Knots can carry one of four color markers (actions menu), shown next to the label chip and persisted in the .skein file; navbar filter buttons show only knots with a chosen marker (or a marked descendant)
- Prompt to reload the active session's .skein file when it changes on disk outside Dialog IDE
- "Export Web Page..."'s story-metadata query (title/author/IFID/etc.) now also respects `<name>.dgdebug.dg`/`<name>.<format>.dg` source-suffix filtering, matching every other dgdebug launch - a source meant only for a specific export format could previously leak into it

## 0.3.0 - 19 Aug 2026

- "Export Web Page..."'s attachments ("feelies", e.g. the "how to play IF" PDFs) are now configurable via `dialog.json`'s `feelies` array, instead of a hardcoded pair of filenames; "Add Feelie..." (also available via right-click in the Explorer) and "Remove Feelie..." commands manage them. A configured feelie whose file is missing is now an export error, not a silent omission
- Command input (new commands and "Edit Command...") now lowercases and collapses consecutive whitespace, not just trims
- "Edit Command..." and "Insert Parent..." no longer reject a command that collides with an existing sibling - the two knots merge instead (recursively, through matching descendants), keeping the merged knot locked/labeled if either side was
- Warn when `dialog.json` declares the same source file in more than one category (or twice in one), since Dialog would compile it twice - new `dialog-ide.warnOnDuplicateSource` setting

## 0.2.0 - 16 Aug 2026

- Run the Skein using `frotz`/`frotz-release` (dfrotz) as the engine - requires `dfrotz` on `PATH` or `binDir` (not yet bundled)
- "Initialize Dialog Project" no longer asks for target format(s); removed `dialog.json`'s `target` field
- "Export Web Page..." now asks which export configuration builds the downloadable story file, instead of building every target
- ⌘⇧A / Ctrl+Shift+A now opens the Command Palette while the Skein or Trace panel has focus
- A labeled knot is now treated as locked (can't be deleted) even if never explicitly locked
- Export commands' post-export notification now says "Reveal in Finder" on macOS instead of "Reveal in Explorer"
- Fixed the nav graph's expand/collapse icon drifting off its connector line for a small/narrow skein

## 0.1.0 - 15 Aug 2026

- Bundle the Dialog toolchain (`dgdebug`/`dialogc`) and AAmachine (`aambundle`) with the extension on Windows, Apple Silicon Macs, and Linux (x64), so most users no longer need to install either separately; other platforms still resolve via `PATH` or `dialog.json`'s `binDir`, which always takes priority
- "Initialize Dialog Project" command: scaffolds `dialog.json`, `main`/`lib`/`debug`/`test` directories, a starter `main/main.dg`, bundled copies of the standard libraries (`stdlib.dg`/`stddebug.dg`/`unit.dg`), a placeholder `cover.png`, and the two "how to play IF" PDFs used by "Export Web Page..." into an open, empty workspace folder
- "Configure Exports..." and "Export Dialog Project..." commands: define named export configurations (output format, whether to include debug sources, output path, extra `dialogc` options such as `--heap`/`--aux`) in `dialog.json`, then compile a `.zblorb`/`.z8`/`.aa` game file via `dialogc`; a `zblorb` export bakes in the project's `cover.png`, if present. "Configure Exports..." also sets a project-wide default set of `dialogc` options, used by any export configuration that doesn't specify its own, and by "Export Web Page..."
- "Export Web Page..." command: builds every one of the project's targets plus an AAmachine in-browser player, and assembles a downloadable web page (cover thumbnail, story file downloads, "how to play IF" PDFs, an optional walkthrough from `default.skein`) into `out/web/` plus a zip; deleting a PDF (or `cover.png`) from the project root simply omits it from the exported page rather than erroring
- "Run Tests" command: runs `dgdebug` in a terminal with the `main`/`debug`/`test` source categories all active, so `test`'s own `lib/unit.dg` overrides `(program entry point)` and runs the project's `(test *)`-trait objects; dgdebug drops into its own debug prompt once the tests finish (rather than quitting immediately), so the pass/fail output stays visible; re-running the command replaces the previous run's terminal instead of opening a new tab each time

## 0.0.2 - 13 Aug 2026

- Rewrote `README.md` for end users (Dialog authors), covering the Skein workflow, keyboard shortcuts, and project setup
- Moved developer-facing content (source layout, build/test/package workflow) into `technical-design.md`
- Nav graph connectors now use an orthogonal elbow (vertical, then a sharp turn to horizontal, then a slightly curved turn back to vertical) instead of a bezier curve
- Nav graph's expand/collapse control is now a larger boxed +/- icon instead of a small chevron, with an opaque interior so the connector line no longer bleeds through it
- Outline view (and breadcrumbs, Ctrl+Shift+O) for `.dg` source files: topics as collapsible nodes, rule definitions nested underneath
- Workspace-wide "Go to Symbol" (Ctrl+T/Cmd+T) across all `.dg` source files in a project, kept current via a file watcher as sources are edited/added/removed
- Editing, adding, or deleting a project's `.dg` source files, or its `dialog.json`, now restarts the `dgdebug` process on the next command so changes take effect immediately
- Warn when a newly created `.dg` file isn't covered by any `dialog.json` source: a dismissible notification plus a persistent Explorer badge, both with a one-click "Add to dialog.json" fix; configurable via `dialog-ide.warnOnUncoveredSource`
- Vendored `.dg` syntax highlighting, folding, and bracket/indentation support directly into the extension (previously provided by the separate `sideburns3000.dialog-language-support` extension via `extensionDependencies`, which also brought along conflicting "Compile to Z8/etc." commands); that dependency has been dropped. If it's still separately installed, a one-time startup notice suggests disabling/uninstalling it
- A custom `.dg` file icon (two overlapping speech bubbles) for icon themes that don't already provide one of their own

## 0.0.1 - 11 Aug 2026

Initial release.

- Skein engine for the `dgdebug` interpreter: process management, session orchestration, tag-line prompt detection
- Transcript and nav-graph webview UI, with full keyboard-first navigation
- Bless/undo/redo, Replay and Replay All, time travel, Insert Parent, Splice Out, knot labels and locking
- Dynamic state capture and diffing (`@dynamic`)
- Trace panel with click-through to source
- Full-text search over knot labels and responses
- `.skein` file persistence, compatible with dialog-tool's flat-file format
- `dialog.json` project support (source discovery/ordering)
- VS Code extension packaging (`.vsix`), icon, and Apache-2.0 license
