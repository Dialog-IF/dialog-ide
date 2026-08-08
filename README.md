# Dialog IDE with Skein Engine

This project is a VS Code extension for Dialog interactive fiction development. Its core is the Skein engine: process management for dgdebug and dfrotz interpreters, session orchestration, tree structure handling for command execution history, and a web service interface (Datastar/SSE) for UI rendering inside a webview panel.

See `technical-design.md` for the full design and `master-spec.md` for the product-level spec.

## Project Structure

```
src/
├── extension.ts                # VS Code extension entry point
└── dialoged/
    └── skein/
        ├── process.ts          # Process management for interpreters
        ├── session.ts          # Session orchestration
        ├── tree.ts             # Tree structure for execution history
        ├── service.ts          # Web service interface
        ├── dynamic.ts          # @dynamic output parsing
        ├── persistence.ts      # Skein flat-file persistence
        └── io.ts                # Tag-line prompt detection and response parsing
```

## Components

1. **Process Management** (`process.ts`)
   - `SkeinProcess` class for managing interpreter processes
   - Support for `dgdebug`, `frotz`, and `frotz-release` engines
   - Command line argument construction for each interpreter type

2. **Session Management** (`session.ts`)
   - `SkeinSession` class for orchestrating command execution
   - Session state management with tree and process references
   - Start/stop lifecycle methods

3. **Tree Structure** (`tree.ts`)
   - `SkeinTree` class representing execution history as an immutable tree
   - `WireKnot`/`DerivedKnot` data structures for command/response pairs
   - Tree navigation, blessing, and editing operations (delete, splice, insert parent, etc.)

4. **Web Service Interface** (`service.ts`)
   - `SkeinService` class for HTTP endpoints backing the webview UI
   - SSE event streaming framework

5. **Dynamic State Processing** (`dynamic.ts`)
   - `DynamicProcessor` class for parsing dgdebug's `@dynamic` output into flags/vars
   - State change diffing between two snapshots

6. **Persistence Layer** (`persistence.ts`)
   - `PersistenceManager` for `.skein` file I/O
   - Flat-file, VCS-diff-friendly format matching dialog-tool's real format (not JSON)

7. **Input/Output Detection** (`io.ts`)
   - `IoDetector` class implementing the tag-line prompt protocol (`--tag-lines` / `-r lt`)
   - Buffers raw interpreter output and parses it into clean content + prompt type

## Technical Specifications

- **Language**: TypeScript
- **Build System**: TypeScript compiler (`tsc`)
- **Runtime**: VS Code extension host (Node.js)
- **File Format**: Flat-text `.skein` files, diff-friendly for version control
- **Architecture**: CQRS-ish core engine with SSE integration to a webview UI

## Building and Testing

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

To run the extension itself, open the project in VS Code and press F5 to launch an Extension Development Host.

## Status

Core Skein engine components (`tree.ts`, `dynamic.ts`, `io.ts`, `persistence.ts`) are implemented and unit-tested against real `dialog-tool` reference behavior. Known gaps: `process.ts` still needs real stdout stream parsing wired to `io.ts`; `service.ts` is a stub with no real HTTP/SSE implementation yet; `session.ts` needs active-knot-aware command execution and dynamic-state tracking.
