# Dialoged IDE Integration Documentation

## Overview

This repository contains documentation and integration details for the Dialoged IDE, specifically focusing on the Skein engine that powers interactive debugging and narrative exploration.

The Skein represents the interactive user interface itself, while the Skein engine is the underlying background process that executes the interactive fiction (dfrotz or dialogc wrapped by application logic to parse its output).

## Core Components

### 1. Process Management (`skein/process.ts`)

Manages interaction with interpreter processes:
- **dgdebug**: Debugging version of the Dialog interpreter that provides detailed trace output
- **dfrotz**: Frotz interpreter for running zcode games
- **Command Input/Output**: Handles sending commands and reading responses from processes

### 2. Session Management (`skein/session.ts`)

Maintains session state and orchestrates command execution:
- Tree structure maintenance
- Command execution flow control
- State tracking through dynamic updates
- Process cleanup and resource management

### 3. Tree Structure (`skein/tree.ts`)

Represents the command execution history as a tree:
- Knots: Individual command/response pairs
- Children: Branching points in the narrative flow  
- Metadata: Engine type and seed information

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

## IDE Integration Features

### Interactive Debugging
- Real-time trace visualization during debugging sessions
- Source code navigation from trace output 
- Dynamic state tracking that updates as commands execute

### File-based Workflow  
- Persistent skein files that store execution history
- Automatic loading of previous sessions
- Export/import capabilities for sharing experiences

### Web-based UI
- Reactive user interface using Hyper and Datastar/SSE
- Browser-based access to debugging information
- Responsive design that works across different screen sizes

## Command Flow

1. **Session Creation**: Initialize process and tree structure  
2. **Command Execution**: Send command to process
3. **Response Reading**: Parse output for prompt type
4. **State Update**: Update tree with response and determine next state
5. **Navigation**: Move to appropriate knot based on response

## Architecture Notes

The system is designed around the concept of a "skein" - a branching narrative that can be replayed, explored, and navigated. The skein represents the interactive user interface itself, while the Skein engine is the underlying background process that executes the interactive fiction (dfrotz or dialogc wrapped by application logic to parse its output).

The Skein engine integrates with the Dialoged IDE through:
- Project Root Detection: Automatically discovers project files using `dialog-tool.project-file`
- Source File Resolution: Maps trace output to actual source code locations 
- Process Management: Launches interpreters with appropriate flags and paths
- State Persistence: Saves and loads execution state in project-specific directories
- Session Cleanup: Properly manages process lifecycle during session close

## Key Files

- `skein-spec.md`: Complete specification of the Skein engine architecture
- `src/dialoged/skein/`: Core implementation files
  - `process.ts`: Process management and I/O handling
  - `session.ts`: Session orchestration  
  - `tree.ts`: Tree structure and knot management
  - `service.ts`: Web service interface for UI
  - `trace.ts`: Trace output parsing
  - `syntax.ts`: Syntax highlighting
  - `search.ts`: Search functionality
  - `dynamic.ts`: Dynamic state processing
  - `source_handlers.ts`: Source code viewing endpoints

## Usage

The Skein engine can be used through:
1. **Command Line Tools**: Using `dialog-tool` CLI commands
2. **IDE Integration**: Through the Dialoged IDE's debugging interface  
3. **Direct API**: Programmatic access through TypeScript functions

For more detailed information about each component, refer to the `skein-spec.md` file.