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

Keep commit messages concise - a short summary line (and a brief body only if it adds real context), not an exhaustive bullet list of every change.

## Changelog

When committing, ensure the changelog is up to date with the committed changes.

Keep changelog entries concise - a short phrase per change, not a detailed explanation of how or why it works.

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
Produces a `.vsix` installable via `code --install-extension` or the Extensions view's "Install from VSIX...", without needing the Marketplace. `package.json`'s `"files"` array is an explicit allowlist (`dist/**/*`, `media/**/*`, `syntaxes/**/*`, `bin/**/*`, `language-configuration.json`, `README.md`, `LICENSE`, `THIRD_PARTY_LICENSES.md`, plus each production dependency's `node_modules` path individually) - there's no bundler (no webpack/esbuild), so a new runtime dependency (or new static asset like the grammar) needs its own line there or it silently won't ship, producing a `Cannot find module` crash on activation on a machine without this repo's own `node_modules`.

`win32-x64`/`darwin-arm64`/`linux-x64` builds also bundle the `dgdebug`/`dialogc` binaries under `bin/<target>/`, so those platforms work without a separately installed Dialog toolchain (see `resolveBundledBinDir`/`resolveCommandPath` in `project.ts`). `bin/` is gitignored and populated on demand by `scripts/fetch-dialog-binaries.js` from the upstream release pinned in `scripts/dialog-toolchain-version.json` - it's normal for `bin/` to be absent during ordinary local development (`npm test`/`npm run build` don't need it), and every other platform/target (including the universal no-target package) keeps relying on `PATH`/`dialog.json`'s `binDir` exactly as before. See `THIRD_PARTY_LICENSES.md` for the bundled binaries' upstream license.

Published to the VS Code Marketplace as `hlship.dialog-ide`. See the `release-to-marketplace` skill (`.claude/skills/release-to-marketplace/SKILL.md`) for confirming the version/release notes and pushing the release tag; `.github/workflows/release.yml`, triggered by that tag push, does the actual build/publish (all four targets, staging bundled binaries per target) and creates the GitHub Release.

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
- `syntax.ts` - reuses the real TextMate grammar vendored under this repo's own `syntaxes/` (via `vscode-textmate`/`vscode-oniguruma`), originally from the `sideburns3000.dialog-language-support` extension (MIT-licensed - see `THIRD_PARTY_LICENSES.md`), to highlight source snippets in the Trace panel - not a from-scratch tokenizer. This same vendored grammar (plus `language-configuration.json`) also drives general `.dg` editor syntax highlighting/folding/bracket-matching/indentation, contributed by this extension's own `package.json` (`contributes.languages`/`grammars`) - no longer a separate `extensionDependencies` entry
- `persistence.ts` - `.skein` flat-file I/O (VCS-diff-friendly, not JSON)
- `project.ts` - reads this IDE's `dialog.json` project descriptor, expands declared sources
- `compile-error.ts` - `DialogCompileError`, thrown when a freshly spawned `dgdebug` dies before its startup banner (a source compile error), or when `frotz-build.ts`'s `dialogc` pre-flight compile fails
- `frotz-build.ts` - `buildFrotzGame`: compiles a project's sources (patch source prepended) into a `.zblorb` via `dialogc`, for `frotz`/`frotz-release` sessions
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

1. **`frotz`/`frotz-release` run via a real subprocess, not a pty.** dfrotz is launched exactly like dgdebug - plain `child_process.spawn` with pipe stdio, `-r lt` putting it into the same tag-line batch mode `--tag-lines` gives dgdebug (see `io.ts`'s `IoDetector`). Unlike dgdebug, dfrotz needs a pre-compiled `.zblorb`: `SkeinSession.buildProcessConfig` calls `frotz-build.ts`'s `buildFrotzGame` (a `dialogc` pre-flight step) for either engine, compiling fresh into a temp dir on every session start with `resources/dfrotz-skein-patch.dg` prepended to suppress dfrotz's own status-bar line (which would otherwise land inline in the transcript and break tag-line parsing). `@dynamic`, tracing, and queries remain dgdebug-only concepts and stay gated off for both frotz engines.
2. All communication between the webview and the extension host happens over local HTTP + SSE (`SkeinService`), not VS Code's webview postMessage API - the webview is just an iframe pointed at a `localhost` port.
3. The UI is reactive via Datastar (`data-on:*` attributes + `datastar-patch-elements` SSE events), not a client framework - `render.ts`'s own HTML strings are the only templating.
4. `SkeinTree`'s undo/redo covers structural edits (bless, delete, splice, label/lock, running a new command) - pure navigation (`setActiveKnot`, `navigateSpine`, `seekStatus`, menu toggles, collapse/expand) deliberately never pushes an undo snapshot, unlike dialog-tool's own `session/capture-undo`-on-everything convention.
5. When porting a piece of dialog-tool's behavior, verify it against the *current* dialog-ide convention first (e.g. sibling order is centralized in `tree.ts`'s `sortedChildren` and shared by the nav graph and keyboard navigation; a knot's own status vs. its aggregated `treeState` are deliberately different fields) - several places have intentionally diverged rather than copying dialog-tool 1:1.

## Known gaps

- `dfrotz` isn't bundled per-platform the way `dgdebug`/`dialogc` are (see `scripts/fetch-dialog-binaries.js`) - frotz's own upstream has no prebuilt-binary releases to fetch, only source, so `frotz`/`frotz-release` sessions currently rely on `dfrotz` being on `PATH` or a project's configured `binDir`.
- No "Reload" action (re-reading a `.skein` file from disk after external changes) - dialog-tool has one, dialog-ide doesn't yet.
