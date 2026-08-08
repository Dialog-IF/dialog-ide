# Technical Design Document: Dialog IDE

## Table of Contents
1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
4. [Data Models](#data-models)
5. [UI Components](#ui-components)
6. [Tool Integration](#tool-integration)
7. [File Format Specifications](#file-format-specifications)
8. [Performance Considerations](#performance-considerations)
9. [Security Considerations](#security-considerations)
10. [Testing Strategy](#testing-strategy)

## Introduction

This technical design document provides detailed specifications for implementing the Dialog IDE, building upon the master specification and referencing dialog-tool's implementation patterns where appropriate. The design focuses on creating a robust, performant, and user-friendly development environment that maintains full compatibility with existing Dialog workflows.

## Architecture Overview

### System Architecture
The Dialog IDE follows a client-server architecture pattern with Datastar's approach:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   UI Layer      │    │  Core Engine     │    │  Tool Interface │
│ (Electron/TS)   │    │ (TypeScript)     │    │ (Process Mgmt)  │
│                 │    │                  │    │                 │
│  - Editor       │    │  - Skein Tree    │    │  - dialogc      │
│  - Graph View   │    │  - File Manager  │    │  - dgdebug      │
│  - Menu System  │    │  - State Mgmt    │    │  - frotz        │
│  - Theme Mgr    │    │  - Undo/Redo     │    │  - aambundle    │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    ┌─────────────────────────────┐
                    │   Operating System          │
                    │  - File System              │
                    │  - Process Management       │
                    │  - Terminal I/O             │
                    └─────────────────────────────┘
```

### Datastar Architecture Pattern
- **Minimal Client-Side JavaScript**: Nearly all rendering and business logic is handled on the "server" side
- **Server-Driven Updates**: The client establishes an SSE (Server-Sent Events) pipeline for real-time updates
- **Request-Response Cycle**: General cycle is client fetch request followed by SSE update

#### Communication Flow
1. Client starts up and establishes SSE connection to server
2. Client makes fetch requests for data or operations
3. Server processes requests and sends updates via SSE
4. Client receives updates and applies them through Datastar's DOM morphing

### UI Framework Considerations
While the core architecture is server-driven with Datastar, the IDE may still leverage React components where beneficial:

#### Potential React Usage
- **Reusable UI Components**: React components for common UI elements that benefit from componentization
- **Complex Interactions**: Areas requiring sophisticated state management or complex user interactions
- **Third-party Integrations**: Components that integrate with existing React-based tools or libraries

#### Current Status
At this time, the primary architecture remains server-driven with Datastar's DOM morphing. React components are not required for core functionality and would be used only where they provide clear advantages over the server-rendered approach.

### Technology Stack
- **Frontend**: Electron with TypeScript, React components
- **Core Engine**: TypeScript with immutable data structures
- **UI Framework**: Custom implementation with Datastar-inspired reactivity
- **Build Tools**: Webpack for bundling, npm scripts for build processes
- **Testing**: Jest for unit tests, Playwright for integration tests

## Core Components

### 1. Skein Tree Manager
The core of the IDE's functionality, managing the skein data structure with these key features:

#### Data Structure
```typescript
interface Response {
  text: string;
  inputType: 'line' | 'key';
}

interface WireKnot {
  id: number;
  command: string;
  response: Response | null;
  unblessedResponse: Response | null;
  parentId: number | null;
  label: string | null;
  locked: boolean;
}

interface KnotState {
  state: 'new' | 'valid' | 'error';
  treeState: 'new' | 'valid' | 'error';
  selectedChild: number | null;
  children: number[];
}

interface DerivedKnot {
  id: number;
  command: string;
  response: string;
  unblessedResponse: string | null;
  state: 'new' | 'valid' | 'error';
  parentId: number | null;
  children: number[];
  inputType: 'line' | 'key';
  label: string | null;
  locked: boolean;
}

interface SkeinTree {
  knots: Map<number, WireKnot>;
  knotStates: Map<number, KnotState>;
  activeKnotId: number | null;
  fixedWidthFontOverride: boolean;
}
```

#### Operations
- **Tree Navigation**: Efficient traversal of knots with parent-child relationships
- **State Management**: Tracking knot states (new, valid, error)
- **Undo/Redo System**: Full history tracking using persistent data structures with state snapshots
- **Path Analysis**: Identifying all possible paths through the skein

### Knot State Management
Knots maintain two response fields:
- **response**: The blessed/accepted response text
- **unblessedResponse**: The current working response that hasn't been accepted yet

#### Blessing Process
When a knot is blessed:
1. The unblessedResponse value rolls over to replace the response field
2. The unblessedResponse is set to null
3. The knot's state transitions to 'valid'

#### Knot Creation
A new knot is one with no blessed response (response is empty/undefined) and only an unblessedResponse.


### SkeinTree Operations
The SkeinTree supports a finite set of operations that each return a new SkeinTree instance:

#### Core Operations
1. **addChild(parentId: number, childId: number, command: string, response: ResponseWithInputType)**: 
   - Adds a new child knot to an existing parent
   - The new child becomes the selected child of its parent
   - Returns a new SkeinTree with the added child

2. **updateKnotCommandAndResponse(id: number, command: string, response: ResponseWithInputType)**: 
   - Updates an existing knot with a new command text and response text with prompt type
   - Returns a new SkeinTree with the updated knot

3. **updateKnotResponse(id: number, response: ResponseWithInputType)**: 
   - Updates an existing knot with a new response text and prompt type
   - Returns a new SkeinTree with the updated knot

4. **blessKnot(id: number)**: 
   - Blesses a knot by rolling unblessedResponse over to response
   - Clears unblessedResponse
   - Updates knot state to 'valid' if not already 'valid'
   - Returns a new SkeinTree with the blessed knot

5. **deleteKnot(id: number)**: 
   - Deletes a knot and all its descendants recursively
   - Returns a new SkeinTree with the knot removed

6. **spliceKnot(id: number)**: 
   - Deletes a knot and reparents its children to the parent knot
   - Returns a new SkeinTree with the knot spliced out

7. **insertParent(id: number, command: string, response: ResponseWithInputType)**: 
   - Inserts a new parent knot above an existing knot
   - The existing knot becomes a child of the newly inserted parent
   - Returns a new SkeinTree with the modified structure

8. **setLabel(id: number, label: string | null)**: 
   - Sets or clears the label for a knot
   - Returns a new SkeinTree with the updated label

9. **setLockStatus(id: number, locked: boolean)**: 
   - Sets or clears the lock status for a knot
   - Returns a new SkeinTree with the updated lock status

#### Knot State Management
- **DerivedKnot.state** is determined by:
  - No unblessed response → 'new' 
  - No blessed response yet (but has unblessed) → 'new'
  - Blessed response differs from unblessed response → 'error'
  - Blessed response matches unblessed response → 'valid'

#### Tree Status Propagation
- Each knot has a **direct status** (based on its own state)
- Each knot also has a **tree status** that propagates up the tree:
  - Tree status = maximum of direct status and tree statuses of all children
  - Ordering: error > new > valid
  - Used for coloring knots in navigation view

#### Additional Knot Properties
- **Label**: A (tree unique) label that can be assigned to knots
- **Lock Status**: Knots can be locked or unlocked
- Both labels and lock status are persisted in WireKnot and the skein file

### Executor Information
A SkeinTree also stores information necessary to run and re-run the executor:
- **Random number generator seed**: A numeric value used for deterministic execution
- This ensures consistent behavior across runs when using the same seed

### Transcript Generation
To generate a transcript from the tree of knots:

#### Spine Concept
- **Spine**: A sequence of knots from root (id 0) to a single leaf node
- **Transient Data**: Each knot maintains transient data identifying its selected child
- **Path Selection**: At each branching point, one child is selected to continue the path

#### Spine Characteristics
- The spine represents the primary execution path through the skein
- It's possible to collapse children of a knot on the spine
- When collapsed, the spine ends with that non-leaf knot (representing multiple paths)
- This allows for both detailed path exploration and high-level overview views

#### Transcript Structure
The transcript is built by traversing the spine from root to leaf, collecting:
1. Command from each knot in the spine
2. Response from each knot in the spine
3. Any relevant metadata for each step

### Session Management
The skein tree is managed within a Session object that owns:
- The current SkeinTree instance
- Undo and redo stacks for the tree state
- Active knot tracking (activeKnotId)

#### Session Structure

The skein tree is managed within a Session object that owns:

- The current SkeinTree instance
- Undo and redo stacks for the tree state
- Active knot tracking (activeKnotId)
- Engine process management (dgdebug or dfrotz)

```typescript
interface Session {
  tree: SkeinTree;
  undoStack: SkeinTree[];
  redoStack: SkeinTree[];
  activeKnotId: number | null;
  activeProcessKnotId: number | null;
}
```

#### Engine Process Management
The skein manages a subprocess running either dgdebug or dfrotz:

- **Input/Output Handling**: Player input is piped into the process's standard input, and its standard output is captured and parsed
- **Output Parsing**: The skein must parse the output to:
  - Identify actual game output 
  - Deal with the command prompt ("> ")
  - Determine if the user is being prompted for a line of input (normal case) or single key input (rare case)
- **Process State Tracking**: The skein tracks which knot corresponds to the state of the running process
- **Dynamic Process Management**: 
  - Detects when source files are added, modified, or deleted
  - Detects changes in source file order or category
  - Discards the running process and starts a new one including replaying to the active knot
- **Dual Tracking**: The skein must track two values:
  - What knot is active in the skein UI
  - What knot (if any) is active in the running process

#### Root Knot Design
- By design, the root knot is always labeled "START" and has id 0
- No explicit rootId field needed in the tree structure
- The START knot serves as the entry point for all skein execution paths

#### Knot Data Separation
Following the dialog-tree approach:
- **WireKnot**: Minimal data representing exactly what is read/written to file
- **DerivedKnot**: Contains derived information needed for UI management and state tracking
- This separation reduces the number of changes needed to persistent maps for small state modifications

### Undo/Redo Implementation Details

The undo/redo system implements a snapshot-based approach for skein tree modifications:

#### State Management
1. **State Snapshots**: Each action that modifies the skein tree creates a complete snapshot of the current tree state
2. **History Stack**: Maintains a stack of state snapshots with proper undo/redo ordering
3. **Memory Efficiency**: Only stores necessary state changes, not every intermediate step

#### Action Types
- **Node Creation**: Adding new knots to the skein
- **Node Modification**: Changing command/response text or state
- **Node Deletion**: Removing knots from the skein
- **Blessing Operations**: Marking knots as valid/accepted
- **Navigation**: Moving active node position

#### Implementation Approach
1. **Pre-Action Snapshot**: Before executing any modification, save current tree state
2. **Action Execution**: Perform the requested operation on the skein tree
3. **Post-Action State**: Store resulting state for potential redo operations
4. **History Management**: 
   - Push new states onto history stack when actions are completed
   - Clear redo history when new actions are performed after undo
   - Limit history size to prevent memory exhaustion

#### Performance Considerations
- **Lazy Loading**: Only load full tree state when needed for undo/redo operations
- **Delta Tracking**: For large trees, track only differences between states
- **Memory Pooling**: Reuse objects where possible to reduce garbage collection pressure
- **Throttling**: Rate-limit history updates during rapid consecutive operations

#### User Experience
- **Undo/Redo Commands**: Clear visual indicators showing available undo/redo actions
- **Action Grouping**: Complex operations can be grouped for single undo/redo
- **Immediate Feedback**: Visual confirmation when undo/redo operations complete
- **Error Handling**: Graceful handling of corrupted history states

### 2. File Manager
Manages project files and their ordering requirements:

#### Source Organization
Each source file is tracked with its category explicitly by the IDE, as stored in the dialog.json configuration file. The IDE does not enforce a particular directory structure - developers can organize files as they see fit.

```typescript
interface SourceFile {
  path: string;
  category: 'main' | 'debug' | 'library' | 'test';
}

interface Project {
  name: string;
  version: string;
  sourceFiles: SourceFile[];
  build: {
    targets: string[];
    options: {
      zblorb: string[]; // command line arguments as array
      aa: string[];
    };
  };
}
```

#### File Operations
- **Creation/Deletion**: Support for adding/removing source files
- **Order Management**: Enforcing proper compilation order (project → debug → library)
- **File Watching**: Real-time change detection for build triggers
- **Category Tracking**: Explicit tracking of file categories in dialog.json configuration

### 3. Editor Interface
Supports both editing and execution modes with seamless switching:

#### Mode States
```typescript
type IDEMode = 'edit' | 'interact';

interface EditorState {
  mode: IDEMode;
  activeFile: string | null;
  openFiles: Set<string>;
  fileContents: Map<string, string>;
}
```

#### Editor State Properties
- **mode**: Current IDE mode ('edit' or 'interact')
- **activeFile**: Path to the currently active file in the editor (null when no file is open)
- **openFiles**: Set of all currently open file paths
- **fileContents**: Map storing the current content of all open files

### 4. Process Management
Manages the interpreter subprocess (`dgdebug` or `dfrotz`) that backs a session.

#### Engine Types and Launch Arguments

##### dgdebug
```bash
dgdebug --numbered --seed <seed> --width -1 --unit-test --transcripting --tag-lines --formatting ansi <source-file> [<source-file> ...]
```
Unlike dfrotz, dgdebug interprets Dialog source directly — there is no compiled game file. The trailing arguments are the project's `.dg` source files themselves, in compilation order (project sources, then debug-category sources, then libraries) — not a single game path.

##### dfrotz (debug and release)
```bash
dfrotz -q -m -r lt -f normal -s <seed> -w -1 <gamePath>
```
The dfrotz command line is identical for `frotz` and `frotz-release` — the distinction is not a launch flag. It's made earlier, at **compile time**, in which sources get built into `<gamePath>`:
- **`frotz`**: the game is compiled including `debug`-category sources (per the project's `dialog.json`), matching a normal debug build
- **`frotz-release`**: the game is compiled excluding `debug`-category sources — the same "include debug sources or not" toggle used for Export (see [Export Functionality](#export-functionality))

So starting a `frotz` vs. `frotz-release` session requires building (or selecting an already-built) game file with the appropriate source set *before* invoking dfrotz — `gamePath` for the two engine types will typically point at two different compiled outputs. This build isn't a plain export build, either: frotz normally prints a status line that would otherwise land inline in the transcript and break the tag-line parsing below, so the skein-specific build needs to suppress it (dialog-tool's reference implementation does this by compiling in a small patch source ahead of the project's own sources — the current codebase doesn't do this yet).

#### Input/Output Processing
Both `--tag-lines` (dgdebug) and `-r lt` (dfrotz) put the interpreter into a mode where **every line of output is prefixed with a short tag** identifying what kind of line it is. Parsing has to work at the tag level, not by matching a suffix against the whole response blob.

##### Tags

| Line kind | dgdebug tag | dfrotz tag |
|---|---|---|
| Plain content | `"  "` (two spaces) | `"  "` (two spaces) |
| Line-input prompt (final line) | `"> "` | `"T "` (T = numeric turn indicator) followed by the visible `"> "` prompt |
| Keystroke-input prompt (final line) | `") "` | `") "` |

##### Detecting End-of-Response
Read stdout until one of these is true of the raw (untagged) accumulated buffer:
- **Line prompt**: buffer ends with `"\n> "` (dgdebug) or `"\nT > "` (dfrotz) — the leading newline is required; a bare trailing `"> "` is not sufficient, since ordinary content could coincidentally contain it
- **Keystroke prompt**: the buffer's *last line* (not the whole buffer) starts with `") "` — keystroke prompts don't end with a newline, so a whole-buffer suffix check won't match

##### Producing Clean Content
Once a response is complete:
1. Split into lines
2. Drop the interpreter's startup banner lines and leading/trailing blank lines
3. Strip the 2-character tag from the front of every remaining line
4. Drop the residual prompt line itself — it's metadata, not content

The result is the knot's `response.text`; `response.inputType` is `'key'` for a keystroke prompt, `'line'` otherwise.

#### Process Lifecycle
- **Start**: spawn the interpreter with the arguments above; wire stdout/stderr into a response buffer
- **Send Command**: write the command plus a newline to stdin
- **Read Response**: accumulate stdout until a recognized prompt is seen, then resolve with the parsed content and prompt type
- **Terminate**: SIGTERM, then SIGKILL after a grace period if the process hasn't exited

### 5. Dynamic State Tracking
Dynamic state is a **live, ephemeral** view into the running interpreter's global/object state. It is not part of `WireKnot` and is never persisted to the skein file — it exists only while a `dgdebug` session is active and is recomputed on demand.

#### How It Works
1. After the session lands on a knot (a command just executed, or the user selected a different knot while debugging), the session sends the `@dynamic` command to the running process
2. dgdebug responds with a listing of global flags/variables and per-object flags/properties
3. The response is parsed into a `DynamicState` structure and shown as an integrated UI tab (per master-spec.md's non-modal design goal), not a separate modal

#### Data Structure
```typescript
interface DynamicState {
  globals: Record<string, boolean | string | number>;
  objects: Record<string, {
    flags: Record<string, boolean>;
    properties: Record<string, string | number>;
  }>;
}
```

#### Availability
`DynamicState` is only meaningful for the `dgdebug` engine (`dfrotz`/`dfrotz-release` don't support `@dynamic`), and only for the knot the process is currently positioned at (`Session.activeProcessKnotId`). Selecting a different knot re-runs the session up to that knot before dynamic state is refreshed.

### 6. Trace Visualization
Also a live, ephemeral view (not persisted), driven by dgdebug's `--tag-lines` trace output. This is what backs master-spec.md's "Real-time Code Navigation" requirement — clicking a trace line jumps the editor to the source file/line it came from.

#### Trace Line Structure
```typescript
interface TraceNode {
  id: number;
  depth: number;
  type: 'ENTER' | 'QUERY' | 'FOUND' | 'NOW';
  text: string;
  source: {
    file: string;
    line: number;
  } | null;
}
```

#### Parsing
- Trace output is tagged per-line (`--tag-lines`) so it can be correlated with the command that produced it
- Nesting `depth` determines indentation/collapsibility in the trace pane
- `source` is populated when dgdebug's output includes a file:line reference; `null` otherwise (e.g. built-in predicates)
- Parsed trace nodes are a flat array keyed by `id`, scoped to the command/knot that produced them — also not persisted, regenerated by re-running the command

### 7. Full-Text Search
In-memory search over the *blessed* content of the current skein tree, exposed in the Transcript View's search field.

#### Indexed Fields
- `command`
- `response` (blessed text only — unblessed/pending responses are excluded)
- `label`

#### Implementation Notes
- The index is rebuilt in memory from the current `SkeinTree`; it is not persisted
- Any reasonably fast in-process text index is acceptable (a simple inverted index, or a small JS library such as `minisearch`/`flexsearch`) — there's no requirement to depend on Apache Lucene, which is JVM-only and doesn't fit a Node/Electron process
- Results should include enough context for a snippet with the matched term highlighted, plus the knot `id` for jump-to-knot navigation

## Data Models

### 1. Skein Knot Model
The Skein Knot Model is implemented through the WireKnot and DerivedKnot data structures:

#### WireKnot (Persistent Data)
Contains all data that is read/written to files:
- `id`: Unique identifier (incremental ID)
- `command`: Player input text
- `response`: Game response text with input type
- `unblessedResponse`: Current working response that hasn't been accepted yet
- `parentId`: Reference to parent node
- `label`: Optional label for the knot
- `locked`: Boolean indicating if the knot is locked

#### DerivedKnot (Runtime Data)
Contains information used during UI management and state tracking:
- `id`: Unique identifier (incremental ID)
- `command`: Player input text
- `response`: Game response text
- `unblessedResponse`: Current working response that hasn't been accepted yet
- `state`: Visual state indicator ('new', 'valid', 'error')
- `parentId`: Reference to parent node
- `children`: List of child node IDs
- `inputType`: Type of input expected ('line' or 'key')
- `label`: Optional label for the knot
- `locked`: Boolean indicating if the knot is locked

### 2. Project Configuration Model
JSON-based configuration following the master specification:

#### Structure
```json
{
  "name": "project-name",
  "version": "1.0.0",
  "sources": [
    {
      "path": "src/main.dg",
      "category": "main"
    }
  ],
  "build": {
    "targets": ["z8", "aa"],
    "options": {
      "zblorb": ["--cover", "cover.png", "--cover-alt", "Project Cover"],
      "aa": ["--heap", "2000"]
    }
  }
}
```

### 3. Theme Model
Supports both light and dark modes with consistent color schemes:

#### Properties
```typescript
interface Theme {
  name: 'light' | 'dark';
  colors: {
    background: string;
    text: string;
    editorBackground: string;
    editorText: string;
    nodeNew: string;
    nodeValid: string;
    nodeError: string;
    activeNode: string;
    graphBackground: string;
  };
}
```

### 4. Dynamic State Model
See [Process Management / Dynamic State Tracking](#5-dynamic-state-tracking) — `DynamicState` is computed live from the running process and is never part of `WireKnot` or persisted skein data.

### 5. Trace Model
See [Trace Visualization](#6-trace-visualization) — `TraceNode` entries are computed live per command execution and are never persisted.

### 6. Search Model
```typescript
interface SearchResult {
  knotId: number;
  field: 'command' | 'response' | 'label';
  snippet: string; // matched text with surrounding context
}
```

## UI Components

### 1. Editor Interface
#### Layout Structure
- **Left Panel**: File hierarchy tree with expandable/collapsible directories
- **Right Panel**: Tabbed editor windows for open files
- **Bottom Panel**: Status bar, console output, and error indicators

#### Features
- Syntax highlighting for Dialog (.dg) files
- Line numbers and bracket matching
- File type indicators (extension-based)
- Quick file search functionality
- Multiple tab support with ability to view same file in multiple tabs
- Find and replace functionality (within single tab or across all files)
- Jump to line navigation

### 2. Skein Graph View
#### Visualization Requirements
- **Node Representation**: Color-coded knots showing state (new, valid, error)
- **Graph Structure**: Hierarchical layout with parent-child relationships
- **Navigation Controls**: Zoom, pan, and selection tools
- **Interactive Elements**: Click to select nodes, drag to reorganize

### 3. Transcript View
#### Layout Components
- **Command History**: Linear sequence of player commands and game responses
- **Active Node Highlighting**: Clear visual distinction for current position
- **Search Functionality**: Find specific commands or responses within the transcript
- **Input Field**: For entering new commands during execution

### 4. Toolbar Operations
#### Available Actions
- **Navigation**: Back/forward, time travel between knots
- **Label-based Navigation**: Jump directly to any knot by its unique label
- **Editing**: Bless knot, delete knot, edit command/response
- **Replay**: Replay all paths, replay current path
- **Undo/Redo**: Full history management
- **Export**: Save skein to file, export for web deployment

## Tool Integration

### 1. dialogc Compiler Integration
Direct execution of the dialogc compiler with proper error handling:

#### Execution Flow
1. Validate project configuration
2. Determine source file ordering
3. Execute dialogc with appropriate arguments
4. Capture output and errors
5. Update build status in UI

#### Command Line Arguments
```bash
dialogc --target z8 --target aa \
  --zblorb --cover cover.png --cover-alt "Project Cover" \
  --aa --heap 2000 \
  src/main.dg src/scene1.dg lib/debug/debug_util.dg lib/common.dg
```

#### Export Functionality
Export is how the project is shared with users (to play, to playtest). The export process includes:

- **Game File Export**: 
  - Generates game files (.z8, .zblorb, or .aa) depending on project configuration
  - Option to include debug sources or not

- **Web Bundle Export**:
  - Includes HTML title page, the game file, and an HTML/JavaScript player page
  - Generated via the aambundle command
  - Supports both single-file and packaged zip export options

### 2. dgdebug Debugger Integration
Native integration with debugging sessions:

#### Features
- Launch debugger process with proper environment
- Display debug output in integrated console
- Support for breakpoints and step-through execution
- Communication protocol for IDE-dgdebug interaction
- ANSI output support via command line switch

### 3. frotz Engine Integration
Support for alternative debugging approaches:

#### Capabilities
- Pseudo-tty usage for ANSI output generation (required for proper terminal output)
- Font and color handling for terminal output
- Integration with the skein's ANSI formatting support

### 4. aambundle Command Integration
Web interpreter packaging workflow:

#### Functionality
- Integration for creating web interpreters
- Packaging of projects for web deployment
- Export workflow enhancement

#### Web Bundle Contents
The web bundle includes:
- HTML title page with project information
- Game file (.z8, .zblorb, or .aa) 
- HTML/JavaScript player page generated via aambundle command
- All necessary resources for standalone web execution

### 5. ANSI Escape Sequence Handling
The IDE properly handles ANSI escape sequences in game output:

#### Terminal Output Processing
- Support for ANSI color and formatting codes in terminal output
- Proper handling of cursor positioning and screen clearing
- Integration with the skein's ANSI formatting support

#### Input Detection
See [Process Management](#4-process-management) for the concrete prompt-detection rules (line vs. keystroke prompts). Detection is based on matching the trailing or leading prompt text of the response, not a fixed two-character prefix.

### 6. Test Runner Integration
The IDE includes a test runner that executes unit tests:

#### Test Execution
- Automated execution of unit tests defined in the project
- Integration with testing framework (likely based on Dialog's test conventions)
- Results display showing pass/fail status and error details
- Ability to run individual tests or entire test suites
- Integration with IDE's debugging capabilities for test failure investigation

### 7. Dialog-Skein Implementation Details

#### Engine Communication Protocol
The IDE implements the full dialog-skein protocol for communication with engines:

##### Input/Output Processing
- Proper handling of engine prompts and input expectations
- Prompt type is determined by matching the shape of the trailing (or, for dfrotz line prompts, leading) prompt text — see [Process Management](#4-process-management) for the exact rules per engine
- Correctly parsing output streams to separate game text from control sequences

##### ANSI Support
- Full ANSI escape sequence support for color and formatting
- Proper terminal emulation for games that rely on colored text
- Integration with IDE's theme system for consistent appearance

##### State Management
- Tracking of engine state through the conversation
- Synchronization between IDE's internal state and engine's actual state
- Handling of engine restarts and replays

#### Resource Management in Web Bundles
Web bundles created by aambundle include:
- All necessary game assets (images, sounds, etc.) 
- Properly configured HTML/JavaScript player that handles the game flow
- Embedded configuration files for proper game execution
- Responsive design elements for various screen sizes

## File Format Specifications

### 1. Skein File Format (Text-based)
The format follows the established dialog-tool skein file specification:

#### Format Structure
```
seed: 1234567890
---- 
id: 0
command: START
----
This is the blessed response text.
```

#### File Header
- Only the seed value appears prior to the first knot
- No other header information is included
- Format: `key: value` format (snake cased keys)
- No comment lines ('#') are used

#### Knot Structure
Each knot begins with a line of ---- characters (at least 4), followed by:
1. Key/value pairs for the knot properties
2. Another ---- divider
3. The response text (blessed response) - there is no separate "response" key
4. When there is an unblessed response, it is separated from the response by a >>>> delimeter line

#### Knot Properties
- `id`: Numeric knot identifier (ascending order)
- `command`: Player input text
- `parent-id`: Reference to parent node (omitted for root knot)
- `input-type`: Type of input expected ('line' or 'key') - defaults to 'line' and normally omitted
- `label`: Optional label for the knot
- `locked`: Boolean indicating if the knot is locked - defaults to false and normally omitted

#### Notes
- Knots are always written in ascending order by knot id
- Knot ids are numeric with a soft guarantee that larger numbers represent a later point in time
- Knot ids do not have to be purely sequential (they are seeded from wall clock time, then increment by one)
- The file format maintains full compatibility with existing dialog-tool skein files

### 2. Configuration File Format (dialog.json)
Standard JSON format as specified in the master document:

#### Validation Requirements
- All required fields present
- Source file paths are valid
- Build targets are supported
- Command line arguments are properly formatted

## User Flow

### Project Lifecycle
Users can either create a new project or open an existing one. The workflow begins in the code editor where developers write and modify Dialog source files (.dg).

### Execution and Skein Creation
When users launch the skein, it displays as a transcript of running the game - a series of commands entered by the user and responses from the game engine. As users interact with the game:
- New knots are created automatically 
- Newly created knots are visibly marked with a yellow border to indicate they are new (until blessed)
- The navigation view shows the full graph of knots and grows as new knots are added
- One knot is designated as the active knot, highlighted in the navigation view with a special blue transcript border

### Interactive Editing
As users make changes to the source code, the IDE automatically:
- Reruns the engine (dgdebug or frotz) 
- Replays the interaction to the active knot along the spine
- Updates responses as needed

### Full Replay Operations
It is common for users to perform a full replay - this finds every leaf knot in the tree and runs the commands from root to leaf, collecting any changed responses along the way. This operation may take a few seconds and will display a modal progress dialog.

### Active Knot Modifications
The active knot can be subject to various user-driven changes:
- Setting or clearing a label
- Locking or unlocking (locked knots cannot be deleted)
- Splicing out a knot 
- Inserting a new parent for the knot
- Editing the command for the knot

### UI Feedback and Statistics
When replaying interactions, knots whose blessed response does not match the current response are marked as invalid:
- **Transcript View**: Red border around invalid knots in the transcript
- **Navigation Graph**: Red highlight in the navigation graph for invalid knots

In addition, part of the skein UI displays statistics showing:
- Total number of valid knots
- Total number of new knots  
- Total number of invalid knots

## Performance Considerations

### 1. Memory Management
- **Persistent Data Structures**: Use immutable data structures with Clojure-style structural sharing for skein tree to enable efficient undo/redo

### 2. Data Structure Selection
For TypeScript implementation, considering the following persistent data structure options:

#### Available Libraries
- **Immutable.js**: Well-established library with comprehensive API, good performance characteristics
- **Mori**: Lightweight alternative to Immutable.js with similar API
- **Immer**: Proxy-based approach that allows direct mutation while producing immutable results
- **Custom implementations**: Tailored specifically for the Dialog IDE's needs

#### Considerations
- **Interoperability**: Ensure chosen library works well with standard JavaScript types and functions
- **Performance**: Evaluate memory usage and execution speed for typical skein operations
- **Tooling Support**: Consider integration with existing development tools and debugging workflows
- **Bundle Size**: For Electron application, minimize impact on overall bundle size

#### Recommendation
The implementation will use a combination of:
1. **Immutable.js** for core tree structures to ensure reliable persistence with structural sharing
2. **Immer** for UI-level modifications where direct mutation is more convenient
3. **Custom wrapper functions** to handle interoperability between different data structure types

### 3. Rendering Optimization
- **Virtual Scrolling**: Only render visible nodes in the graph view (as memory is not a problem even with hundreds of knots)
- **Canvas-based Rendering**: For large skein graphs using HTML5 Canvas (as memory is not a problem even with hundreds of knots)
- **Debounced Updates**: Throttle UI updates during rapid changes
- **Datastar Approach**: Leverage Datastar's DOM-morphing capabilities for efficient rendering
  - Datastar generally renders the entire page and lets the DOM morpher make changes efficiently
  - This approach is very fast and eliminates the need for complex virtual loading implementations

### 4. File System Operations
- **File Watching**: Efficient file system monitoring for change detection
- **Batch Processing**: Group multiple file operations to reduce I/O overhead
- **Caching**: Cache frequently accessed files and metadata

## Security Considerations

### 1. Process Isolation
- **Sandboxed Execution**: External tools run in isolated processes
- **Input Sanitization**: Validate all command-line arguments
- **Resource Limits**: Set memory and time limits for external processes

### 2. File System Access
- **Path Validation**: Ensure file operations stay within project boundaries
- **Permission Checks**: Verify read/write permissions for files
- **Security Scanning**: Scan files for potential security issues during import

## Testing Strategy

### 1. Unit Testing
#### Core Components
- Skein tree manipulation functions
- File manager operations
- Theme switching functionality
- Configuration parsing/validation

#### Test Coverage
- 90%+ code coverage for core logic
- Edge case testing for data structures
- Performance benchmarks for large skeins

### 2. Integration Testing
#### Tool Integration
- dialogc compilation workflow
- dgdebug debugger integration
- frotz engine execution
- aambundle export functionality

#### UI Integration
- Mode switching between edit/execute
- File creation/deletion workflows
- Skein navigation and editing operations

### 3. End-to-End Testing
#### User Workflows
- Complete development cycle from file creation to skein execution
- Cross-file navigation capabilities
- Error handling and recovery scenarios

#### Compatibility Testing
- Backward compatibility with existing skein files
- Performance testing with large projects
- Cross-platform functionality verification