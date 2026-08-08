# Dialog IDE with Skein Engine

This project implements the Skein engine for Dialog interactive fiction development. The Skein engine provides process management for dgdebug and dfrotz interpreters, session orchestration, tree structure handling for command execution history, and web service interface for UI rendering.

## Project Structure

```
src/
├── dialoged/
│   └── skein/
│       ├── process.ts          # Process management for interpreters
│       ├── session.ts          # Session orchestration
│       ├── tree.ts             # Tree structure for execution history
│       ├── service.ts          # Web service interface
│       ├── dynamic.ts          # Dynamic state processing
│       ├── persistence.ts      # Session persistence
│       └── io.ts               # Input/output detection
├── main.js                     # Electron main process
└── index.html                  # Main UI
```

## Components Implemented

1. **Process Management** (`process.ts`)
   - `SkeinProcess` class for managing interpreter processes
   - Support for `dgdebug`, `dfrotz`, and `dfrotz-release` engines
   - Command line argument construction for each interpreter type

2. **Session Management** (`session.ts`)
   - `SkeinSession` class for orchestrating command execution
   - Session state management with tree and process references
   - Start/stop lifecycle methods

3. **Tree Structure** (`tree.ts`)
   - `SkeinTree` class representing execution history as a tree
   - `Knot` data structure for command/response pairs
   - Tree navigation and child management

4. **Web Service Interface** (`service.ts`)
   - `SkeinService` class for HTTP endpoints
   - Session management capabilities
   - SSE event streaming framework

5. **Dynamic State Processing** (`dynamic.ts`)
   - `DynamicProcessor` class for parsing @dynamic output
   - State change detection and tracking

6. **Persistence Layer** (`persistence.ts`)
   - `PersistenceManager` for file I/O operations
   - Session saving/loading capabilities

7. **Input/Output Detection** (`io.ts`)
   - `IoDetector` class for prompt type detection
   - Response parsing with prompt stripping

## Technical Specifications

- **Language**: TypeScript
- **Build System**: TypeScript compiler (tsc)
- **Runtime**: Node.js with Electron for desktop UI
- **File Format**: JSON-based skein files with versioning
- **Architecture**: CQRS pattern with SSE integration

## Building and Testing

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Implementation Status

All core Skein engine components have been implemented according to the technical specifications:

- Process management for interpreter engines
- Session orchestration with command execution flow
- Tree structure representation of execution history
- Web service interface for UI communication
- Dynamic state processing from @dynamic output
- Persistence layer for session data
- Input/output detection for different interpreter types

## Future Work

The implementation provides a solid foundation that can be extended with:
- Advanced error recovery mechanisms
- Performance optimizations for large sessions
- Enhanced web service endpoints
- Comprehensive testing suite
- IDE integration features