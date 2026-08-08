# Detailed Technical Specification: Skein Engine

## 1. Overview

The Skein engine is a sophisticated system for managing interactive command sessions in Dialog interactive fiction. It provides process management for dgdebug and dfrotz interpreters, session orchestration, tree structure handling for command execution history, and web service interface for UI rendering.

## 2. File Format Specification

### 2.1 Skein File Format
- **Version**: 1.0.0 (semantic versioning)
- **Encoding**: UTF-8
- **Format**: JSON
- **Structure**:
```json
{
  "meta": {
    "engine": "dgdebug" | "frotz" | "frotz-release",
    "seed": 12345,
    "version": "1.0.0",
    "created": "2026-08-01T12:00:00Z",
    "modified": "2026-08-01T12:00:00Z"
  },
  "knots": {
    "knot-id": {
      "id": "knot-id",
      "parentId": "parent-id",
      "command": "command-string",
      "label": "optional-label",
      "response": "response-content",
      "unblessed": false,
      "promptType": "line" | "keystroke",
      "dynamic": {
        "globals": {},
        "objects": {}
      },
      "source": {
        "file": "source-file.dlg",
        "line": 123
      }
    }
  },
  "children": {
    "parent-id": ["child-id-1", "child-id-2"]
  },
  "selected": {
    "parent-id": "selected-child-id"
  },
  "status": {
    "knot-id": "executed" | "pending" | "error"
  }
}
```

## 3. Process Management Specifications

### 3.1 Interpreter Launch Arguments
The Skein engine supports three interpreter types with specific launch arguments:

#### dgdebug
```bash
dgdebug --numbered --seed 12345 --width -1 --unit-test --transcripting --tag-lines --formatting ansi game.zblorb
```

#### dfrotz (debug mode)
```bash
dfrotz -q -m -r lt -f normal -s 12345 -w -1 game.zblorb
```

#### dfrotz (release mode)
```bash
dfrotz -q -m -r lt -f normal -s 12345 -w -1 game.zblorb
```

### 3.2 Process Lifecycle Management
- **Start**: Launch interpreter with appropriate arguments and setup I/O streams
- **Send Command**: Write command to process stdin with proper line termination
- **Read Response**: Parse output stream for prompts (line or keystroke)
- **Terminate**: Graceful shutdown with SIGTERM, fallback to SIGKILL if needed

## 4. Input/Output Processing

### 4.1 Prompt Detection Logic
The system distinguishes between different types of input prompts:

#### dgdebug prompts:
- **Line prompts**: End with "> " (e.g., "What do you want to do? > ")
- **Keystroke prompts**: Start with ") " (e.g., ") Press any key to continue...")

#### dfrotz prompts:
- **Line prompts**: Start with "\nT > " where T is text indicator (e.g., "\n1 > ", "\n2 > ")
- **Keystroke prompts**: Start with ") " (e.g., ") Press any key to continue...")

### 4.2 Response Processing Pipeline
1. Read output from process stdout/stderr
2. Detect prompt type using pattern matching
3. Strip prompt indicators from content
4. Parse dynamic state information if present
5. Buffer output for proper response formatting

## 5. Web Service Interface

### 5.1 Session Management Endpoints
- `POST /sessions` - Create new session
- `GET /sessions/{id}` - Get session details  
- `DELETE /sessions/{id}` - Terminate session
- `POST /sessions/{id}/commands` - Execute command

### 5.2 SSE Event Types
- `knot-executed`: New knot added to tree
- `knot-error`: Error occurred during execution
- `session-updated`: Session state changed
- `process-output`: Process output received

## 6. Tree Structure and Knot Management

### 6.1 Knot Data Structure
Each knot represents a single command/response pair with:
- `id`: Unique identifier
- `parentId`: Parent knot reference (null for root)
- `command`: Command that was executed
- `label`: Optional descriptive label
- `response`: Response from interpreter
- `unblessed`: Flag indicating if response is trusted
- `promptType`: Type of prompt received ("line" or "keystroke")
- `dynamic`: Dynamic state information
- `source`: Source file and line number

### 6.2 Tree Navigation
The tree structure supports:
- Branching through command execution history
- Navigation between parent/child nodes
- Selection tracking for current execution point
- Status tracking for each knot (executed, pending, error)

## 7. Dynamic State Processing

### 7.1 @dynamic Command Integration
After each command execution, the Skein engine:
1. Executes `@dynamic` command to capture state information
2. Parses dynamic output into structured data
3. Updates tree with dynamic state changes

### 7.2 DynamicKnot Structure
```typescript
interface DynamicKnot {
  globals: Record<string, boolean>;
  objects: Record<string, {
    flags: Record<string, boolean>;
    properties: Record<string, any>;
  }>;
  changes?: Array<{
    type: 'global' | 'object';
    name: string;
    field: string | null;
    oldValue: any;
    newValue: any;
  }>;
}
```

## 8. Performance Requirements

### 8.1 Memory Usage Targets
- Maximum session size: 100MB
- Memory footprint per knot: < 1KB
- Garbage collection optimization for large sessions

### 8.2 Response Time Requirements
- Command execution response: < 500ms (95th percentile)
- UI update latency: < 100ms (after SSE notification)
- File save operations: < 2s for typical sessions

## 9. Security Considerations

### 9.1 Process Isolation
- Child processes run in isolated environments
- Resource limits for process execution
- Secure command injection prevention
- File access restrictions

### 9.2 Data Integrity
- Atomic file operations for session persistence
- Validation of all input data
- Error recovery mechanisms
- Secure handling of sensitive information

## 10. Testing Strategy

### 10.1 Unit Tests
- Individual components (process management, parsing)
- Integration tests for full execution flows
- End-to-end tests with actual interpreter processes

### 10.2 Performance Benchmarks
- Memory usage monitoring
- Response time measurements
- File I/O performance testing

## 11. Future Extensions

### 11.1 Additional Engine Types
- Support for additional interpreter backends as needed
- Plugin architecture for new engine types

### 11.2 Advanced Features
- Collaboration support with multiple users
- Cloud-based session storage
- Enhanced visualization capabilities
- Machine learning for command prediction

## 12. Implementation Notes

The Skein engine implementation follows a CQRS (Command Query Responsibility Segregation) pattern with SSE (Server-Sent Events) integration for real-time updates to the UI. The architecture is designed to be modular, maintainable, and extensible.

Key design decisions include:
- TypeScript implementation for type safety
- Modular component structure for easy testing and maintenance
- Event-driven architecture for responsive UI updates
- Comprehensive error handling and recovery mechanisms
- Performance optimization for large session management

This specification provides the complete technical foundation for implementing a robust Skein engine that meets all requirements outlined in the original documentation.