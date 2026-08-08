# Dialoged IDE Project Guide for Claude Code

## Codebase Overview

This is a TypeScript/JavaScript VS Code extension for Dialog interactive fiction development. The project implements a skein-based system for managing interactive command sessions, with the core functionality centered around the Skein engine.

The **skein** represents the interactive user interface itself - a branching narrative that can be replayed, explored, and navigated. The **skein engine** is the underlying background process that executes the interactive fiction (dfrotz or dialogc wrapped by application logic to parse its output).

## Architecture

The codebase follows a clear separation of concerns:

1. **Core Engine**: `src/dialoged/skein/` - Implements the Skein engine with:
   - Process management for dgdebug and dfrotz
   - Session orchestration 
   - Tree structure handling for command execution history
   - Input/output detection and parsing
   - Web service interface using Hyper for UI rendering

2. **IDE Integration**: `src/dialoged/` - Provides IDE-specific functionality:
   - Project discovery and configuration
   - File system integration
   - VS Code extension host (`src/extension.ts`) and webview-based GUI components
   - Debugging and session management within the IDE context

## Development Commands and Workflows

### Running the IDE
Open the project in VS Code and press F5 to launch an Extension Development Host (see `.vscode/launch.json`).

### Building the Application
```bash
npm run build
```

### Testing
```bash
npm test
```

## Key Files

Implemented:
- `src/dialoged/skein/process.ts` - Process management and I/O handling
- `src/dialoged/skein/session.ts` - Session orchestration
- `src/dialoged/skein/tree.ts` - Tree structure and knot management (`WireKnot`/`DerivedKnot`, blessing, undo/redo state)
- `src/dialoged/skein/service.ts` - Web service interface for UI
- `src/dialoged/skein/dynamic.ts` - Dynamic state processing
- `src/dialoged/skein/persistence.ts` - Session persistence
- `src/dialoged/skein/io.ts` - Input/output prompt detection

Planned, not yet implemented (see `technical-design.md` Core Components 4-7):
- `src/dialoged/skein/trace.ts` - Trace output parsing and source-line navigation
- `src/dialoged/skein/search.ts` - Full-text search over blessed knot content
- Syntax highlighting for the editor (not yet assigned a file)

## Session Management in IDE Context

When working with sessions in the IDE:

1. Sessions are created using either `create-new!` or `create-loaded!` functions
2. The session maintains a tree structure of executed commands and responses
3. Process management handles launching dgdebug or dfrotz interpreters
4. Response processing detects input prompts and parses output
5. State tracking enables navigation through the command history
6. File-based persistence saves execution state in skein files

## Implementation Context

This is a VS Code extension that provides a rich IDE experience for Dialog development inside the editor. The Skein engine runs as a background process managed by the extension host, communicating with a webview-hosted UI through HTTP endpoints and Datastar/SSE for reactive updates.

The implementation handles:
- Process lifecycle management
- Complex input/output parsing from interpreters
- State persistence and recovery
- Integration with existing Dialog project structures
- Web-based UI rendering using Hyper and Datastar/SSE

## Development Notes

When working on this codebase, keep in mind that:
1. The Skein engine is designed to work with both dgdebug (for debugging) and dfrotz (for gameplay)
2. All communication between the IDE and the Skein engine happens through HTTP endpoints
3. The UI is reactive and updates in real-time using Datastar/SSE
4. Session state is persisted in JSON files for later replay
5. The system handles complex interactive fiction workflows with branching paths