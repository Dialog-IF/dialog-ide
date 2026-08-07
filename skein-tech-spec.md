# Skein Engine Technical Specification

## Architecture Overview

The Skein engine is a sophisticated system designed for interactive debugging and narrative exploration of Dialog games. It combines process management, state tracking, and web-based visualization to provide developers with powerful tools for understanding and manipulating dialog execution.

The skein represents the interactive user interface itself, while the Skein engine is the underlying background process that executes the interactive fiction (dfrotz or dialogc wrapped by application logic to parse its output).

## Core Data Structures

### Tree Structure
```json
{
  "meta": {"engine": "dgdebug", "seed": 12345},
  "knots": {"0": {"id": 0, "command": "start", "response": "...", "prompt": "line"}},
  "children": {"0": ["1", "2"]},
  "selected": {"0": 1},
  "status": {"0": "executed"}
}
```

### Skein Header
The skein file header contains metadata about the session, including:
- **engine**: The interpreter engine used for this session ("dgdebug", "frotz", or "frotz-release")
- **seed**: Random seed value used for game state initialization
- The engine key should be stored in the header and defaults to "dgdebug" if omitted

### Knot Structure
```json
{
  "id":          // Unique identifier
  "parent-id":   // Parent knot identifier  
  "command":     // Command that was sent
  "label":       // Optional descriptive label
  "response":    // Process response text
  "unblessed":   // Unverified response (for replay)
  "prompt":      // "line" or "keystroke"
}
```

## Process Management

### Engine Types and Launch Arguments

#### dgdebug
```bash
dgdebug --numbered --seed 12345 --width -1 --unit-test --transcripting --tag-lines --formatting ansi
```

#### dfrotz (Debug Mode)
```bash
dfrotz -q -m -r lt -f normal -s 12345 -w -1 path/to/game.zblorb
```

#### dfrotz (Release Mode)
```bash
dfrotz -q -m -r lt -f normal -s 12345 -w -1 path/to/game.zblorb
```

### Input/Output Processing

The system uses a sophisticated scanner to detect input prompts:

1. **Line Input Detection**: 
   - dgdebug: Uses "> " suffix
   - dfrotz: Uses "\nT > " prefix (where T is text indicator)

2. **Keystroke Input Detection**:
   - Both engines use ") " prefix for keystroke prompts

3. **Response Parsing**: 
   - Removes leading/trailing whitespace
   - Handles ANSI escape sequences
   - Strips prompt indicators from response content

## Session Management

### Key Functions

#### Create New Session
Creates a new session with fresh tree structure.

#### Load Existing Session  
Loads an existing session from file, resuming execution.

#### Execute Command
Executes a single command in the current session:
1. Sends command to process
2. Reads response 
3. Updates tree structure
4. Determines next state

## State Tracking and Dynamic Updates

The dynamic processing module handles @dynamic output from dgdebug to track state changes:

### Predicate Processing
- Global flags and variables are tracked separately
- Per-object predicates are flattened with object names
- Special handling for parent/relationship predicates merged into location predicates

### Output Format Example
```
Global flags:
  (has been visited)
  
Object flags:
  (is a $) [object1]
```

## File I/O Operations

The system implements atomic file operations to ensure data integrity:

### Save Operations
- Writes to temporary file first
- Renames temporary file to final location
- Preserves existing data during failures

### Load Operations  
- Validates file structure before loading
- Handles corrupted files gracefully
- Maintains backward compatibility with older formats

## Web Service Interface

The Skein engine provides a web service interface through Hyper:

### Routing
- `/skein/` - Main skein UI endpoints
- `/source/` - Source code viewing endpoints  
- `/trace/` - Trace output visualization
- `/api/` - API endpoints for programmatic access

### Datastar/SSE Integration
- Reactive server-rendered UI components
- Real-time state updates through Server-Sent Events
- Client-side state management with Datastar framework

## Development and Testing

### Unit Tests
- Component-level testing for tree operations
- Process management verification
- File I/O operation validation

### Integration Tests
- End-to-end session execution flows
- Web service endpoint testing
- Interactive debugging scenarios

## Performance Considerations

### Memory Management
- Efficient tree structure representation
- Lazy loading of knot content
- Garbage collection optimization for large sessions

### Response Processing
- Streaming input/output handling
- Prompt detection with minimal overhead
- ANSI sequence parsing optimization

## Security and Reliability

### Process Isolation
- Child processes run in isolated environments
- Resource limits for process execution
- Secure command injection prevention

### Data Integrity
- Atomic file operations
- Validation of all input data
- Error recovery mechanisms