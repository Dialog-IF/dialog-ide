# Dialoged IDE Project Guide for Claude Code

## Codebase Overview

This is a TypeScript VS Code extension for Dialog interactive fiction development. The project implements a skein-based system for managing interactive command sessions, with the core functionality centered around the Skein engine.

The **skein** represents the interactive user interface itself - a branching narrative that can be replayed, explored, and navigated. The **skein engine** is the underlying background process that executes the interactive fiction (currently `dgdebug` only at runtime - see "Known gaps" below) wrapped by application logic that parses its output.

This is a from-scratch TypeScript port of `dialog-tool` (a Clojure sibling project implementing the same Skein concept as a standalone CLI + browser app). Comments throughout the codebase frequently reference dialog-tool's own source files (`session.clj`, `tree.clj`, `app.clj`, etc.) as the design's origin - when in doubt about intended behavior, that's often the fastest way to check intent, though dialog-ide has diverged in places (see "Development Notes").

## Architecture

The codebase follows a clear separation of concerns:

1. **Core Engine**: `src/dialoged/skein/` - Implements the Skein engine: process management for `dgdebug`, session orchestration, an immutable tree structure for command execution history, input/output prompt detection, dynamic-state/trace parsing, full-text search, and a hand-rolled HTTP + SSE web service (no framework - plain `http`, Datastar on the client) backing a webview-hosted UI.

2. **IDE Integration**: `src/` - Provides IDE-specific functionality:
   - `extension.ts` - VS Code extension host entry point: owns the `SkeinService` lifecycle, the skein webview panel, the Trace panel view, and run-configuration commands
   - `session-runner.ts` - Pure logic behind those run-configuration commands, deliberately free of any `vscode` import so it's unit-testable without mocking the extension host

## Development Commands and Workflows

## Commits

Do not commit with out confirming with the user.

## Changelog

When committing, ensure the changelog is up to date with the committed changes.

### Running the IDE
Open the project in VS Code and press F5 to launch an Extension Development Host (see `.vscode/launch.json`).

### Building the Application
```bash
npm run build
```
Runs `build:css` (Tailwind, scanning the actual source for classes used) then `tsc`.

### Testing
```bash
npm test
```
Jest. Nearly everything mocks `child_process` - the two exceptions (`dgdebug-integration.spec.ts`, `session-runner.spec.ts`) spawn a real `dgdebug` and self-skip (`describe.skip`/`it.skip`) when it isn't on `PATH`, so the suite stays portable to machines/CI without the Dialog toolchain installed (verified: 675/681 pass with the toolchain fully hidden). CI runs this on every PR via `.github/workflows/test.yml`.

### Packaging
```bash
npx vsce package
```
Produces a `.vsix` installable via `code --install-extension` or the Extensions view's "Install from VSIX...", without needing the Marketplace. `package.json`'s `"files"` array is an explicit allowlist (`dist/**/*`, `media/**/*`, `README.md`, `LICENSE`, plus each production dependency's `node_modules` path individually) - there's no bundler (no webpack/esbuild), so a new runtime dependency needs its own line there or it silently won't ship, producing a `Cannot find module` crash on activation on a machine without this repo's own `node_modules`. Not yet published to the Marketplace.

## Key Files

Core engine (`src/dialoged/skein/`):
- `process.ts` - `SkeinProcess`: spawns/talks to the interpreter, tag-line buffering
- `session.ts` - `SkeinSession`: the whole session API (commands, navigation, bless/undo/redo, trace, search, dynamic state) - the biggest file, and the one most other layers call into
- `tree.ts` - `SkeinTree`: immutable persistent tree (`WireKnot`/`DerivedKnot`, blessing, spine/sibling navigation queries, undo/redo snapshots are just old tree references)
- `service.ts` - `SkeinService`: HTTP + SSE web service backing the webview, one route per user action
- `io.ts` - `IoDetector`: tag-line (`--tag-lines`/`-r lt`) prompt-type detection, including single-keystroke prompts
- `dynamic.ts` - `DynamicProcessor`: parses `@dynamic` output into flags/vars, diffs two snapshots
- `trace.ts` - parses `(trace on)`/`--trace` output into a searchable node tree
- `search.ts` - full-text search over knot labels/responses
- `syntax.ts` - reuses the `sideburns3000.dialog-language-support` extension's real TextMate grammar (via `vscode-textmate`/`vscode-oniguruma`) to highlight source snippets in the Trace panel - not a from-scratch tokenizer, and not the same thing as `.dg` editor syntax highlighting (that's the other extension's own job, declared as an `extensionDependencies` entry)
- `persistence.ts` - `.skein` flat-file I/O (VCS-diff-friendly, not JSON)
- `project.ts` - reads this IDE's `dialog.json` project descriptor, expands declared sources
- `compile-error.ts` - `DialogCompileError`, thrown when a freshly spawned `dgdebug` dies before its startup banner (a source compile error)
- `progress.ts` - `ProgressHost` seam over `vscode.window.withProgress`, so session/service code never imports `vscode` directly

UI layer (`src/dialoged/skein/ui/`), all plain TypeScript template-literal HTML (no JSX, no client framework beyond vendored Datastar for `data-on:*`/SSE patching):
- `render.ts` - main skein webview: navbar, transcript, command input (including the keystroke-prompt variant)
- `tree-pane.ts` - the left-pane nav graph (the whole tree, not just the active spine)
- `knot-menu.ts` - the per-knot actions popover, shared by both panes
- `traceRender.ts` - the separate Trace panel webview
- `diff.ts` - word-level diff between a knot's blessed/unblessed response
- `ansi.ts` - ANSI SGR → styled HTML or `[B]...[/B]`-style visible markers

IDE integration (`src/`):
- `extension.ts` - extension host entry point
- `session-runner.ts` - pure run-configuration logic

Client-side (`media/js/`, no build step, no TS - plain browser JS):
- `main.js` - keyboard accelerators (see below), modals, tree-graph SVG drawing/drag-to-pan, focus management
- `trace.js` - Trace panel's own search/source-preview interactions

## Session Management in IDE Context

Sessions are created via `SkeinSession.createNew(config)` (fresh skein) or `SkeinSession.createLoaded(tree, config)` (from a parsed `.skein` file) - both static factory methods, not the Clojure-style `create-new!`/`create-loaded!` functions dialog-tool uses, despite the doc comments referencing that origin.

1. `SkeinSession` maintains a `SkeinTree` (execution history) and a `SkeinProcess` (the live interpreter), plus `processPositionId` tracking where the process actually is vs. `tree.getActiveKnotId()` (which knot is currently displayed/navigated to) - these can diverge (clicking around the tree, "time travel"), and most command-running paths silently replay to catch up rather than treating that as an error.
2. Response processing (`io.ts`) detects the prompt type (`line` vs `key`) per response; a keystroke-prompt response gates several operations (`@dynamic` capture, tracing) since injecting a line-mode debugger command mid-keystroke-read isn't safe.
3. The active knot can be moved via a plain click (`setActiveKnot`, which extends the spine down through any already-explored single-child chain) or via keyboard: ⌥↑/↓/←/→ and ⌥⇧↑/↓ (`navigateSpine` - parent/child/prev-sibling/next-sibling/first/last), ⌥X (toggle-expand), and the navbar's clickable new/error count badges (`seekStatus`, cycling with wraparound, remembering position per status).
4. File-based persistence (`persistence.ts`) saves/loads the tree to/from a flat-text `.skein` file.

## Development Notes

1. **`dgdebug` is the only runtime-functional engine right now.** `process.ts` builds a command line for `frotz`/`frotz-release` (dfrotz) too, but `SkeinSession.buildProcessConfig` throws for any non-`dgdebug` engine - `@dynamic`, tracing, and queries are dgdebug-only concepts anyway, so frotz support needs its own compile-to-zblorb pre-flight step (via `dialogc`) before it's worth wiring up.
2. All communication between the webview and the extension host happens over local HTTP + SSE (`SkeinService`), not VS Code's webview postMessage API - the webview is just an iframe pointed at a `localhost` port.
3. The UI is reactive via Datastar (`data-on:*` attributes + `datastar-patch-elements` SSE events), not a client framework - `render.ts`'s own HTML strings are the only templating.
4. `SkeinTree`'s undo/redo covers structural edits (bless, delete, splice, label/lock, running a new command) - pure navigation (`setActiveKnot`, `navigateSpine`, `seekStatus`, menu toggles, collapse/expand) deliberately never pushes an undo snapshot, unlike dialog-tool's own `session/capture-undo`-on-everything convention.
5. When porting a piece of dialog-tool's behavior, verify it against the *current* dialog-ide convention first (e.g. sibling order is centralized in `tree.ts`'s `sortedChildren` and shared by the nav graph and keyboard navigation; a knot's own status vs. its aggregated `treeState` are deliberately different fields) - several places have intentionally diverged rather than copying dialog-tool 1:1.

## Known gaps

- `frotz`/`frotz-release` engines aren't runnable yet (see Development Notes #1).
- No "Reload" action (re-reading a `.skein` file from disk after external changes) - dialog-tool has one, dialog-ide doesn't yet.
- Not yet published to the VS Code Marketplace (packaging is set up - see "Packaging" above - but publisher registration/PAT setup is a manual, one-time step outside this repo).
