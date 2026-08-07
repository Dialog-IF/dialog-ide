# Dialog Skein Engine Documentation

## Overview

This is a collection of documentation about the Dialog Skein engine and its integration with the Dialog IDE. The Skein engine provides interactive debugging and narrative exploration capabilities for Dialog games.

## Key Files

- **skein-spec.md**: High-level specification of the Skein engine architecture
- **skein-tech-spec.md**: Technical specification with detailed implementation details  
- **README.md**: Overview documentation for the Dialog IDE integration

## Components

### Core Engine Components
- `skein/process.clj`: Process management and I/O handling
- `skein/session.clj`: Session orchestration  
- `skein/tree.clj`: Tree structure and knot management
- `skein/dynamic.clj`: Dynamic state processing from dgdebug output
- `skein/trace.clj`: Trace output parsing
- `skein/search.clj`: Search functionality over blessed knot content
- `skein/service.clj`: Web service interface for UI
- `skein/source_handlers.clj`: Source code viewing endpoints

### UI Components
- `skein/ui/app.clj`: Main application page rendering
- `skein/ui/components/`: Reusable UI components
- `skein/ui/modals.clj`: Modal dialog components
- `skein/ui/tree_pane.clj`: Tree view component
- `skein/ui/trace_view.clj`: Trace output visualization

## Integration Points

The Skein engine integrates with the Dialog IDE through:
1. Project root detection using `dialog-tool.project-file`
2. Source file resolution from trace output 
3. Process management for dgdebug and dfrotz interpreters
4. State persistence in project-specific directories
5. Web-based UI through Hyper framework

## Engine Types Supported

1. **`:dgdebug`** - Debugging mode with detailed tracing
2. **`:frotz`** - Frotz interpreter for zcode games (with debug flags)  
3. **`:frotz-release`** - Frotz interpreter in release mode

## Key Features

- Interactive debugging with real-time trace visualization
- Source code navigation from trace output
- Dynamic state tracking that updates during command execution
- Persistent skein files for replay and exploration
- Web-based UI with reactive updates using Hyper/Datastar/SSE
- Full-text search over execution history