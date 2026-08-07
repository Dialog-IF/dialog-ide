# Skein Engine Specification

## Overview

The Skein engine is a system for managing interactive dialog experiences through structured command execution and state tracking. It provides a framework for building, replaying, and navigating interactive narrative experiences.

## Core Components

### 1. Process Management

Manages interaction with interpreter processes:

- **dgdebug**: Debugging version of the Dialog interpreter that provides detailed trace output
- **dfrotz**: Frotz interpreter for running zcode games
- **Command Input/Output**: Handles sending commands and reading responses from processes

Key functions:
- `start-debug-process!`: Starts a debug process with tagged output
- `start-frotz-process`: Starts a dfrotz process with appropriate flags  
- `send-command!`: Sends commands to the process with keystroke detection
- `read-response!`: Reads and parses responses from the process

### 2. Session Management

Maintains session state and orchestrates command execution:

- **Tree Structure**: Maintains a tree of executed commands and their responses
- **Command Execution**: Handles sending commands and managing response processing
- **State Tracking**: Tracks active knot, undo/redo stack, and UI state

Key functions:
- `run-command!`: Executes a single command in the session
- `create-loaded!`: Creates a new session from an existing tree
- `create-new!`: Creates a new session with fresh tree

### 3. Tree Structure

Represents the command execution history as a tree:

- **Knots**: Individual command/response pairs
- **Children**: Branching points in the narrative flow  
- **Metadata**: Engine type and seed information

Key functions:
- `new-tree`: Creates a new tree with given engine and seed
- `add-child`: Adds a child knot to the tree
- `find-child-id`: Finds child knot by command

### 4. Input/Output Detection

The system distinguishes between different types of input prompts:

- **Line input prompts**: End with specific characters (e.g., "> " for dgdebug, "\nT > " for dfrotz)
- **Keystroke prompts**: Start with specific characters (e.g., ") " for both)  
- **Response processing**: Parses output to determine prompt type and content

## Engine Types

The Skein engine supports multiple interpreter backends:

1. **`:dgdebug`** - Debugging mode with detailed tracing
2. **`:frotz`** - Frotz interpreter for zcode games (with debug flags)  
3. **`:frotz-release`** - Frotz interpreter in release mode

## Key Features

### 1. Interactive Navigation
- Tree-based navigation through command history
- Branching point management
- Undo/redo functionality  

### 2. Response Processing
- Automatic detection of input prompts
- Different handling for keystroke vs line input
- State tracking through dynamic updates

### 3. Persistence
- File-based storage of tree state
- Load/save operations with atomic writes
- Metadata preservation (engine type, seed)

## Command Flow

1. **Session Creation**: Initialize process and tree structure  
2. **Command Execution**: Send command to process
3. **Response Reading**: Parse output for prompt type
4. **State Update**: Update tree with response and determine next state
5. **Navigation**: Move to appropriate knot based on response

## Data Structures

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

## Input/Output Processing

The system uses tagged output from interpreters to determine when input is expected:

- **dgdebug**: Uses "> " for line prompts and ") " for keystroke prompts  
- **dfrotz**: Uses "\nT > " for line prompts and ") " for keystroke prompts
- **Prompt Detection**: Logic determines prompt type based on response structure

## Architecture Notes

The system is designed around the concept of a "skein" - a branching narrative that can be replayed, explored, and navigated. The skein represents the interactive user interface itself, while the Skein engine is the underlying background process that executes the interactive fiction (dfrotz or dialogc wrapped by application logic to parse its output).

## IDE Integration

The Skein engine is designed to work seamlessly with the Dialog IDE, providing:

### 1. Interactive Debugging
- Real-time trace visualization during debugging sessions
- Source code navigation from trace output 
- Dynamic state tracking that updates as commands execute

### 2. File-based Workflow  
- Persistent skein files that store execution history
- Automatic loading of previous sessions
- Export/import capabilities for sharing experiences

### 3. Web-based UI
- Reactive user interface using Hyper and Datastar/SSE
- Browser-based access to debugging information
- Responsive design that works across different screen sizes

### 4. Development Tools Integration
- Integration with existing Dialog project structure
- Support for both dgdebug and dfrotz interpreters
- Command-line tooling for testing and creating skeins

## Project Structure Integration

The Skein engine integrates with the Dialog IDE through:

- **Project Root Detection**: Automatically discovers project files 
- **Source File Resolution**: Maps trace output to actual source code locations 
- **Process Management**: Launches interpreters with appropriate flags and paths
- **State Persistence**: Saves and loads execution state in project-specific directories

## Command Execution Flow

1. **IDE Initiation**: User triggers debug/run command from IDE
2. **Process Launch**: Skein engine starts dgdebug or dfrotz with proper arguments
3. **Command Input**: IDE sends commands through the Skein interface  
4. **Response Processing**: Engine parses output and detects prompts
5. **UI Update**: Browser UI updates with new state and trace information
6. **State Persistence**: Execution history saved to skein file for later replay

This architecture enables developers to:
- Step through interactive dialog experiences programmatically
- Debug complex narrative flows with detailed trace information
- Revisit previous execution paths and explore different branches
- Analyze state changes during command execution

## Additional Components

### Commands

Provides CLI commands for working with skeins:
- `test-skein`: Tests existing skeins for correctness
- `run-skein`: Runs the Skein UI for an existing skein file  
- `new-skein`: Creates a new skein and runs the UI

### Source Handlers

Handles source code viewing endpoints:
- View source files in context of trace nodes
- Preview source content with proper formatting
- Resolve source locations from trace output

### Trace Processing

Parses Dialog debugger trace output into structured data:
- Extracts trace lines with nesting levels, types (ENTER, QUERY, FOUND, NOW)
- Parses source file and line information from trace output
- Stores trace data as flat node map for UI navigation

### Syntax Highlighting

Provides syntax highlighting for Dialog source files:
- Tokenizes Dialog source code with HTML spans for CSS styling
- Supports multiple token types (comments, keywords, predicates, etc.)
- Handles HTML escaping before wrapping in styled spans

### Search Functionality

In-memory full-text search over blessed knot content:
- Uses Apache Lucene for indexing and searching
- Indexes command, response, and label fields
- Provides snippet extraction with term markup for search results

### Dynamic State Processing

Parses dgdebug dynamic output to track state changes:
- Processes @dynamic output into predicate maps
- Flattens predicates with object names for better presentation
- Handles both global and per-object flags and variables

### Service Layer

Provides the web service interface for the Skein UI:
- Wraps the Skein session in an HTTP service using Hyper
- Serves reactive server-rendered UI over Datastar/SSE
- Manages routing for skein pages and source viewing endpoints
- Handles application state management through hyper's app-state atom
- Supports development mode and shutdown handling

### UI Components

Provides the user interface elements for the Skein tool:
- **app**: Main application page rendering
- **actions**: UI action handlers for navigation and interaction
- **modals**: Modal dialog components for trace details and source viewing
- **tree_pane**: Tree view component for navigating command history
- **trace_view**: Trace output visualization
- **components/**: Reusable UI components like buttons, input fields, etc.