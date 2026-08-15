# Changelog

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
