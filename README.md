# Dialog IDE with Skein Engine

This project is a VS Code extension for Dialog interactive fiction development. Its core is the Skein engine: process management for the `dgdebug` interpreter, session orchestration, an immutable tree structure for command execution history, and a web service interface (Datastar/SSE) for UI rendering inside a webview panel.

See `technical-design.md` for the full design and `master-spec.md` for the product-level spec.

## Project Structure

```
src/
├── extension.ts                 # VS Code extension entry point
├── session-runner.ts            # Pure logic behind run-configuration commands
└── dialoged/
    └── skein/
        ├── process.ts           # Process management for the dgdebug interpreter
        ├── session.ts           # Session orchestration - commands, navigation, bless/undo, trace, search
        ├── tree.ts              # Immutable tree structure for execution history
        ├── service.ts           # HTTP + SSE web service backing the webview UI
        ├── dynamic.ts           # @dynamic output parsing and diffing
        ├── trace.ts             # (trace on)/--trace output parsing into a searchable node tree
        ├── search.ts            # Full-text search over knot labels/responses
        ├── syntax.ts            # Trace-panel source highlighting (reuses the Dialog language extension's grammar)
        ├── persistence.ts       # Skein flat-file (.skein) persistence
        ├── project.ts           # dialog.json project discovery and source expansion
        ├── compile-error.ts     # DialogCompileError - a source compile failure on process startup
        ├── progress.ts          # Seam over vscode.window.withProgress (keeps session/service vscode-free)
        ├── io.ts                # Tag-line prompt detection (line vs. single-keystroke) and response parsing
        └── ui/
            ├── render.ts        # Main skein webview: navbar, transcript, command input
            ├── tree-pane.ts     # Left-pane nav graph (the whole tree, not just the active spine)
            ├── knot-menu.ts     # Per-knot actions popover, shared by both panes
            ├── traceRender.ts   # Trace panel webview
            ├── diff.ts          # Word-level diff between a knot's blessed/unblessed response
            └── ansi.ts          # ANSI SGR -> styled HTML / visible diff markers
media/js/
├── main.js                      # Keyboard accelerators, modals, tree-graph drawing/drag-to-pan
└── trace.js                     # Trace panel's own search/source-preview interactions
```

## Components

1. **Process Management** (`process.ts`)
   - `SkeinProcess` class for managing the interpreter process
   - Command line argument construction for `dgdebug`, `frotz`, and `frotz-release` (only `dgdebug` is runnable end-to-end today - see Status)

2. **Session Management** (`session.ts`)
   - `SkeinSession` class: the whole session API - running commands, keyboard/click navigation of the spine and siblings, bless/undo/redo, Insert Parent, tracing, dynamic-state capture, search, seek-to-next-error/new knot

3. **Tree Structure** (`tree.ts`)
   - `SkeinTree` class representing execution history as an immutable persistent tree
   - `WireKnot`/`DerivedKnot` data structures for command/response pairs
   - Tree navigation, blessing, and editing operations (delete, splice, insert parent, rename, label, lock)

4. **Web Service Interface** (`service.ts`)
   - `SkeinService` class: plain `http` + SSE (no framework), one route per user action
   - Also serves the separate Trace panel webview

5. **Dynamic State Processing** (`dynamic.ts`)
   - `DynamicProcessor` class for parsing dgdebug's `@dynamic` output into flags/vars
   - State change diffing between two snapshots

6. **Trace and Search** (`trace.ts`, `search.ts`)
   - Parses dgdebug's trace output into a searchable, collapsible node tree shown in a dedicated Trace panel view
   - Full-text search over knot labels and responses, surfaced in the transcript's search box

7. **Persistence Layer** (`persistence.ts`)
   - `PersistenceManager` for `.skein` file I/O
   - Flat-file, VCS-diff-friendly format matching dialog-tool's real format (not JSON)

8. **Input/Output Detection** (`io.ts`)
   - `IoDetector` class implementing the tag-line prompt protocol (`--tag-lines` / `-r lt`)
   - Buffers raw interpreter output and parses it into clean content, plus whether the next input is a normal line or a single keystroke

9. **UI Layer** (`ui/`)
   - Server-rendered HTML (template literals, no JSX/client framework) reactive via [Datastar](https://data-star.dev/)'s SSE-driven DOM patching
   - Main transcript/nav-graph webview, a separate Trace panel webview, and the shared per-knot actions menu

## Keyboard

The skein is designed to be fully usable without a mouse: ⌥↑/↓/←/→ and ⌥⇧↑/↓ move through the spine and its siblings, ⌥B/⌥R/⌥A/⌥E/⌥L/⌥K/⌥D cover the common per-knot operations, ⌥T traces, ⌥X toggles a subtree, ⌥F focuses search, and ⌘S/⌘Z/⌘⇧Z/⌥⇧R/⌥⇧B cover save/undo/redo/replay-all/bless-transcript. See `media/js/main.js`'s own accelerator table for the full list.

## Technical Specifications

- **Language**: TypeScript (extension host + core engine), plain JavaScript (webview client scripts, no build step)
- **Build System**: TypeScript compiler (`tsc`) + Tailwind CLI for `media/style.css`
- **Runtime**: VS Code extension host (Node.js)
- **File Format**: Flat-text `.skein` files, diff-friendly for version control
- **Architecture**: A local HTTP + SSE service, driven entirely by plain `http`/Datastar - no web framework, no client-side bundler

## Building and Testing

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Package as a .vsix, installable without the Marketplace
npx vsce package
```

To run the extension itself, open the project in VS Code and press F5 to launch an Extension Development Host.

CI runs `npm run build` and `npm test` on every pull request (`.github/workflows/test.yml`). The test suite mocks the interpreter process almost everywhere; the couple of spec files that spawn a real `dgdebug` skip themselves automatically when it isn't installed, so no Dialog toolchain setup is needed to get a meaningful CI signal.

## License

[Apache License 2.0](LICENSE).

## Status

The Skein engine is implemented end-to-end against the `dgdebug` engine: process management, session orchestration (including keyboard navigation, keystroke-input prompts, Insert Parent, and undo/redo), the transcript/nav-graph webview, a separate Trace panel, full-text search, and `.skein` file persistence are all implemented and unit-tested (also validated against a real `dgdebug` binary where available - see Testing).

Known gaps: the `frotz`/`frotz-release` engines aren't runnable yet (only `dgdebug` is wired up at the session layer); there's no "Reload from disk" action; the extension isn't yet published to the VS Code Marketplace (a `.vsix` build works today - see Building and Testing).
