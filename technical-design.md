# Technical Design Document: Dialog IDE

## Table of Contents
1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Source Layout](#source-layout)
4. [Development Workflow](#development-workflow)
5. [Core Components](#core-components)
6. [Data Models](#data-models)
7. [UI Components](#ui-components)
8. [Tool Integration](#tool-integration)
9. [File Format Specifications](#file-format-specifications)
10. [Performance Considerations](#performance-considerations)
11. [Security Considerations](#security-considerations)
12. [Testing Strategy](#testing-strategy)

## Introduction

This technical design document provides detailed specifications for implementing the Dialog IDE, building upon the master specification and referencing dialog-tool's implementation patterns where appropriate. The design focuses on creating a robust, performant, and user-friendly development environment that maintains full compatibility with existing Dialog workflows.

## Architecture Overview

### System Architecture
The Dialog IDE follows a client-server architecture pattern with Datastar's approach:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   UI Layer      │    │  Core Engine     │    │  Tool Interface │
│ (VS Code Ext)   │    │ (TypeScript)     │    │ (Process Mgmt)  │
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
- **Frontend**: VS Code extension host with TypeScript, rendering the Skein UI in a WebviewPanel
- **Core Engine**: TypeScript with immutable data structures
- **UI Framework**: Custom implementation with Datastar-inspired reactivity
- **Build Tools**: tsc, npm scripts for build processes
- **Testing**: Jest, for both unit and integration tests (see [Development Workflow](#development-workflow) - there is no Playwright/E2E layer)

## Source Layout

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

Each file's class/function-level responsibilities are covered in [Core Components](#core-components) below; this tree is the quick map from filename to what lives there.

## Development Workflow

```bash
# Install dependencies
npm install

# Build the project (Tailwind CSS, then tsc)
npm run build

# Run tests
npm test

# Package as a .vsix, installable without the Marketplace
npx vsce package
```

To run the extension itself, open the project in VS Code and press F5 to launch an Extension Development Host (see `.vscode/launch.json`).

CI runs `npm run build` and `npm test` on every pull request (`.github/workflows/test.yml`). The test suite (Jest) mocks the interpreter process almost everywhere; the couple of spec files that spawn a real `dgdebug` (`dgdebug-integration.spec.ts`, `session-runner.spec.ts`) skip themselves automatically when it isn't installed, so no Dialog toolchain setup is needed to get a meaningful CI signal (verified: 675/681 pass with the toolchain fully hidden).

Publishing to the Marketplace is `npx vsce publish` (or `publish patch`/`minor`), gated on a one-time `vsce login <publisher>` using an Azure DevOps PAT scoped to Marketplace: Manage.

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
  treeState: 'new' | 'valid' | 'error';
  parentId: number | null;
  children: number[];
  selectedChild: number | null;
  inputType: 'line' | 'key';
  label: string | null;
  locked: boolean;
}

interface SkeinTree {
  readonly engine: 'dgdebug' | 'frotz' | 'frotz-release';
  readonly seed: number;
  knots: Map<number, WireKnot>;
  knotStates: Map<number, KnotState>;
  activeKnotId: number | null;
}
```
`engine` and `seed` are fixed at creation and never change for the life of a tree — a skein can't switch interpreters or reseed itself after the fact. There's no separate metadata/versioning wrapper around them; they're plain fields.

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
1. **addChild(parentId: number, childId: number, command: string, response: Response)**: 
   - Adds a new child knot to an existing parent
   - The new child becomes the selected child of its parent
   - Returns a new SkeinTree with the added child

2. **updateKnotCommandAndResponse(id: number, command: string, response: Response)**: 
   - Updates an existing knot with a new command text and response text with prompt type
   - Returns a new SkeinTree with the updated knot

3. **updateKnotResponse(id: number, response: Response)**: 
   - Updates an existing knot with a new response text and prompt type
   - Returns a new SkeinTree with the updated knot

4. **blessKnot(id: number)**: 
   - Blesses a knot by rolling unblessedResponse over to response
   - Clears unblessedResponse
   - Updates knot state to 'valid' if not already 'valid'
   - Returns a new SkeinTree with the blessed knot

5. **blessTranscript(id: number)**: 
   - Blesses every **non-valid** knot from root to the given knot (inclusive) - i.e. `blessKnot` applied to each knot on that path that isn't already `'valid'`, skipping the ones that are
   - The caller (`SkeinSession.blessChanges`) always passes `SkeinTree.getSelectedLeafId()`, **not** `activeKnotId` - the active knot can be any knot on the currently selected spine (a plain click doesn't truncate what's shown below it), so targeting it instead of the true leaf would silently leave part of the visible transcript unblessed. `blessTranscript` itself doesn't know or care which id it's given; this is a caller-side convention, not something the tree operation enforces
   - Backs the "Bless Changes" menu action (Skein Menu), as distinct from "Bless Knot"'s single-knot `blessKnot`
   - Returns a new SkeinTree with every non-valid knot on that path now blessed
   - Only touches the currently selected spine - a knot that used to be part of it but was orphaned by a later "New Child" (which clears the ancestor's `selectedChild` so the transcript can show a blank slot for a different command) is, correctly, left alone even if still in error: it's no longer visible in the transcript, so "bless everything visible" doesn't reach it. This is expected behavior, not a bug - confirmed against the real UI, which shows the same knot as an "ancestor of an error" (faded, not full red) rather than a full error itself.

6. **deleteKnot(id: number)**: 
   - Deletes a knot and all its descendants recursively
   - Returns a new SkeinTree with the knot removed

7. **spliceKnot(id: number)**: 
   - Deletes a knot and reparents its children to the parent knot
   - Returns a new SkeinTree with the knot spliced out

8. **insertParent(id: number, command: string, response: Response)**: 
   - Inserts a new parent knot above an existing knot
   - The existing knot becomes a child of the newly inserted parent
   - Returns a new SkeinTree with the modified structure

9. **setLabel(id: number, label: string | null)**: 
   - Sets or clears the label for a knot
   - Returns a new SkeinTree with the updated label

10. **setLockStatus(id: number, locked: boolean)**: 
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
- Tree status is stored per knot (`KnotState.treeState`) and eagerly propagated on every mutation that can affect it, not recomputed from scratch on each read: any operation that changes a knot's own status (`updateKnotCommandAndResponse`, `updateKnotResponse`, `blessKnot`) or its children set (`addChild`, `deleteKnot`, `spliceKnot`, `insertParent`) walks from the affected knot up through its ancestors to the root, recomputing each level from its immediate children's already-correct tree status - O(depth), not O(subtree size)

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

#### Session Structure
The skein tree is managed within a `SkeinSession` object that owns:
- The current `SkeinTree` instance (`activeKnotId` lives on the tree itself, not the session - see the Skein Tree Manager's data structure above)
- Undo and redo stacks for the tree state
- The engine process, plus `processPositionId`: which knot the *process* is actually positioned at, separate from `tree.activeKnotId` (which knot is *displayed*) - these diverge whenever the user navigates without running a command ("time travel"), and most command-running paths silently replay to catch up rather than treating the divergence as an error

The illustrative shape below omits the rest of `SkeinSession`'s real fields (open-menu ids per pane, the dynamic-state display toggle, the per-status "last jumped to" cursor for the navbar's seek badges, the progress host used by Replay All, etc.) - those are session-level UI/navigation state, not part of this data model:

```typescript
interface Session {
  tree: SkeinTree;
  undoStack: SkeinTree[];
  redoStack: SkeinTree[];
  processPositionId: number;
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
Sources are declared by category in a `dialog.json` project file at the project root - behaviorally equivalent to dialog-tool's `dialog.edn` (same source-expansion semantics), but JSON instead of EDN so the IDE can parse it without an EDN dependency. Verified against dialog-tool's `project_file.clj` and its real `test-fixtures/` projects.

```typescript
interface ProjectSources {
  main: string[];
  test?: string[];
  debug?: string[];
  library?: string[];
}

interface DialogProject {
  name: string;
  target: string[]; // normalized to an array; a bare string or an absent key both default to ["zblorb"]
  binDir?: string;   // if set, engine binaries are resolved from here instead of PATH
  sources: ProjectSources;
  rootDir: string;
}
```
Example `dialog.json`:
```json
{
  "name": "The Orb",
  "target": "zblorb",
  "sources": {
    "main": ["src"],
    "debug": ["lib/dialog/debug"],
    "library": ["lib/dialog"]
  }
}
```

Each entry in a `sources` category is either a directory (expanded to its `*.dg` files, sorted, non-recursive) or a specific file path, resolved relative to the project root. `expandSources(project, options)` flattens `main`/`test`/`debug`/`library` into the ordered file list dgdebug/dialogc expect: pre-patch, main, test (if requested), debug (if requested), library - `library` is always included regardless of `debug`/`test`. A file name may embed a target suffix (`effects.zblorb.dg`); when a target is requested, only non-suffixed files and files matching that exact suffix are kept. A source entry that doesn't exist on disk is skipped with a warning rather than failing the whole expansion.

#### File Operations
- **Creation/Deletion**: Support for adding/removing source files
- **Order Management**: Enforcing proper compilation order (main → debug → library), handled by `expandSources`
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

**Current status: all three engines are runnable at the session layer.** `SkeinSession.buildProcessConfig` builds source files directly for `dgdebug`; for `frotz`/`frotz-release` it calls `frotz-build.ts`'s `buildFrotzGame`, a `dialogc`-driven compile-to-zblorb pre-flight step (with the status-line-suppressing patch source mentioned under dfrotz below), run fresh on every session start. Every dgdebug-only capability elsewhere in this document (`@dynamic`, tracing, queries) stays gated off for frotz, since none of them apply to it. `dfrotz` itself isn't bundled per-platform the way `dgdebug`/`dialogc` are (its upstream has no prebuilt-binary releases to fetch) - frotz/frotz-release sessions rely on `dfrotz` being on `PATH` or a project's configured `binDir`.

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

So starting a `frotz` vs. `frotz-release` session requires building the game file with the appropriate source set *before* invoking dfrotz — `gamePath` for the two engine types points at two different compiled outputs (`frotz-build.ts` computes a stable per-project-per-engine path under the OS temp dir, rebuilt fresh on every session start). This build isn't a plain export build, either: frotz normally prints a status line that would otherwise land inline in the transcript and break the tag-line parsing below, so the skein-specific build suppresses it by compiling in a small patch source ahead of the project's own sources (`resources/dfrotz-skein-patch.dg`, matching dialog-tool's reference implementation) — see `buildFrotzGame` in `frotz-build.ts`.

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
2. Drop the `"Line-type display ON"` startup banner line (dfrotz emits this even with `-q`) and leading/trailing blank lines
3. Strip the 2-character tag from the front of every remaining line
4. Drop the residual prompt line itself — it's metadata, not content
5. Strip a leading redundant ANSI SGR-reset sequence (`\x1b[0m`) if present — both engines emit one even when it isn't needed
6. Ensure the result ends with a newline, appending one if it doesn't — a keystroke prompt's content has none of its own, and downstream code (persistence, response-equality checks for blessing) relies on this being consistent

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
2. dgdebug responds with a listing of global and per-object flags and variables, as Dialog predicate patterns (a "$" is a placeholder for a substituted object name or value) — not as named properties
3. The response is parsed into a `DynamicState` and shown as an integrated UI tab (per master-spec.md's non-modal design goal), not a separate modal

This is Dialog-language-specific, dgdebug-only behavior — the format below is verified directly against dialog-tool's `skein/dynamic.clj` and its real captured `@dynamic` transcripts (see `dynamic.spec.ts`), not invented.

#### Response Format
`@dynamic` output has four sections, in order, each optional lines between headers:
```
> @dynamic
GLOBAL FLAGS
        (some fact)                              off
        (another fact)                           on (changed)

PER-OBJECT FLAGS
        ($ is closed)
                #drawer #glove-compartment

GLOBAL VARIABLES
        (remaining cigarettes $)                 6
        (current room $)                         <unset>

PER-OBJECT VARIABLES
        ($ has parent $)
                #flashlight                      #knock
        ($ has relation $)
                #flashlight                      #heldby
```
- A global flag is "set" when its value starts with `on` (a trailing `(changed)` marker may follow either `on` or `off` and doesn't affect this)
- A global variable's value of `<unset>` means the variable isn't tracked/populated — it's dropped rather than kept as a literal string
- Per-object flags/vars list one or more `#object-name` (and, for vars, a value) per line under the fact pattern
- Long lines wrap: a continuation line ending the prior line's word with a hyphen glues with no inserted space (`#pane-of-\ncracked-glass` → `#pane-of-cracked-glass`); any other wrap glues with one space inserted, in addition to whatever leading whitespace the continuation line itself has (this can produce a double space — that's correct, matching dialog-tool's own output, not a bug to "fix")
- Response text arrives with ANSI escape sequences in it (dgdebug's default formatting) — strip those before parsing, not after

#### Data Structure
```typescript
interface DynamicState {
  flags: Set<string>;
  vars: Record<string, string>;
}
```
- `flags`: every currently-set predicate, global and per-object, with `$` substituted for the actual object name (e.g. `(#drawer is closed)`)
- `vars`: predicate pattern → human-readable predicate string with value(s) substituted for `$`. Global vars are keyed by their raw (unflattened) pattern (e.g. `(current room $)`); per-object vars are keyed by the pattern with just the object name substituted (e.g. `(#drawer is $ $)`) — this asymmetry matches dialog-tool's own keying and is preserved for fidelity rather than "fixed"
- The `($ has parent $)` and `($ has relation $)` per-object vars are special-cased: merged into a synthetic `($ is $ $)` "location" var per object (e.g. `(#drawer is #partof #metal-desk)`) rather than appearing as their own separate vars. An object with a parent but no recorded relation gets `<unset>` for the relation slot

#### Diffing
Comparing two `DynamicState`s (typically before/after a command) produces `{added, removed, changed}`: flags/vars present only in the "after" state count as added, present only in "before" count as removed, and vars present in both with different values count as changed (as a `[before, after]` tuple). This is what actually renders as "what changed" in the dynamic state UI tab — showing the full flags/vars dump on every command would be noise.

#### Availability
`DynamicState` is only meaningful for the `dgdebug` engine (`dfrotz`/`dfrotz-release` don't support `@dynamic` - and, as of this writing, aren't runtime-supported at all, see [Process Management](#4-process-management)), and only for the knot the process is currently positioned at (`SkeinSession.processPositionId`). Selecting a different knot re-runs the session up to that knot before dynamic state is refreshed. A knot reached via a keystroke prompt never has its own captured `DynamicState` at all - sending `@dynamic` while the process is mid-keystroke-read isn't safe (same reasoning as tracing below) - the UI falls back to the nearest ancestor's capture for diffing purposes.

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

#### Triggering a Trace
Tracing is dgdebug-only and never touches the knot's stored response - it's a side query, not a tree mutation:
- **Trace a knot's command**: replay the session up to the knot's parent, send `(trace on)`, execute the knot's command, send `(trace off)`, and parse the resulting output into `TraceNode`s. The knot's `response`/`unblessedResponse` are left untouched (the traced output is noise relative to normal transcript content).
- **Trace startup**: restart the process with tracing enabled from launch (an extra `--trace` argument) to capture the traced startup banner, then restart again normally (without `--trace`) to leave the session in its regular state for further commands.
- **Refused for a knot reached via a keystroke prompt**: `(trace on)`/`(trace off)` are line-mode debugger commands - injecting one while the process is mid-keystroke-read (right after replaying to the knot's parent) isn't safe. `SkeinSession.traceKnot` returns `null` in this case (same as its other "not available" cases - a non-dgdebug engine, or the root knot, which has no parent to replay to), and the Trace menu item is shown disabled up front for such knots rather than waiting for a failed attempt. `SkeinSession.insertParent` (see the Skein Tree Manager's `insertParent` operation) applies the identical guard, for the identical reason - a newly inserted knot's command is also always line-mode text.

### 7. Full-Text Search
In-memory search over the current skein tree's settled content, exposed in the Transcript View's search field (`src/dialoged/skein/search.ts`).

#### Indexed Fields
- `label`
- `response` — the blessed response for any knot that has one (even an 'error' knot, whose pending unblessed text is just an unaccepted diff, not canonical yet), or the unblessed response for a knot that's never been blessed at all ('new' state) - the only response text such a knot has

#### Implementation Notes
- No persistent index: every search is a fresh linear pass over the current `SkeinTree` - a skein is realistically at most a few thousand knots, so plain case-insensitive substring matching is fast enough; no Lucene/minisearch/flexsearch dependency needed
- Query terms (whitespace-separated) are ANDed, not ORed, so typing more search text only narrows the result set, never broadens it
- Results are capped (50) so a tree with many matches still renders promptly; the uncapped total match count is also reported so the UI can tell the user results were truncated
- Each result carries a snippet (context around the first match, with every matched term wrapped in `<mark>`) and the knot `id` for jump-to-knot navigation, which reuses the existing select-knot action rather than a bespoke jump endpoint

### 8. Keyboard Navigation & Status Seeking
Master-spec.md's "Keyboard-First Operation" goal, backed by `SkeinSession.navigateSpine`/`seekStatus` (`session.ts`) and a document-level `keydown` listener in `media/js/main.js` - there is no dedicated navigation toolbar in the UI (unlike dialog-tool's), so these are keyboard-only, with no corresponding button to click instead.

#### Spine/Sibling Navigation (`navigateSpine`)
Six directions, all Option/Alt-modified so they work even while the command input has focus (only Option+letter/Option+arrow are safe there - see the accelerator table's own reasoning for why Option+Cmd/Ctrl combos aren't used the same way):

| Direction | Shortcut | Target |
|---|---|---|
| `up` | ⌥↑ | `tree.getKnot(activeId)?.parentId` |
| `down` | ⌥↓ | `tree.getDerivedKnot(activeId)?.selectedChild` |
| `left` | ⌥← | Previous sibling |
| `right` | ⌥→ | Next sibling |
| `first` | ⌥⇧↑ | Root (id 0) |
| `last` | ⌥⇧↓ | `tree.getSelectedLeafId()` |

`up`/`down`/`first`/`last` all target a knot that's provably already on the current selected spine (an invariant every tree mutator that touches `activeKnotId` preserves), so `navigateSpine` routes all six directions through the same `setActiveKnot` (== `tree.selectKnot`) a sibling move needs - for the first four this is a genuine no-op on the spine's own shape, not just "close enough", since `selectKnot`'s own re-pointing and extension logic only ever reassigns something that already points where it's going.

Sibling order (`left`/`right`) is centralized in `SkeinTree.sortedChildren(parentId)` (sorted by command text) - the same method the nav graph (`tree-pane.ts`) uses to render children, so keyboard navigation and the visual layout can never disagree about "next".

A direction with nowhere to go (root has no parent, a leaf has no `selectedChild`, an only child has no sibling, already at the root/leaf) is a silent no-op - no error, no emitted `change` event - mirroring dialog-tool's disabled buttons at the same boundaries rather than wrapping around.

#### Status Seeking (`seekStatus`)
The navbar's new/error count badges (`render.ts`'s `renderNavbar`) are real buttons, disabled when their count is zero. Clicking one jumps to the next knot with that status (`tree.knotIdsWithStatus`, sorted ascending by id - a knot's own status, not its aggregated `treeState`), cycling with wraparound and remembering the last knot jumped to *per status* (`SkeinSession`'s `lastJumpId`) so repeated clicks visit every match in turn. A matching knot can be anywhere in the tree, off the currently displayed spine entirely, so this goes through the full `setActiveKnot` (spine-rewriting) navigation, not the plain pointer-move `up`/`down`/`first`/`last` use.

Deliberately does **not** push an undo snapshot, unlike dialog-tool's own `seek-status` (which calls `session/capture-undo` before every jump) - no pure navigation does in this codebase (see the Undo/Redo Implementation Details section above), only structural edits do.

#### Other Accelerators
⌥B/⌥R/⌥A/⌥E/⌥L/⌥K/⌥D/⌥X cover per-knot operations (bless/replay-to/new-child/edit-command/edit-label/toggle-lock/delete/toggle-expand); ⌘S/⌘Z/⌘⇧Z/⌥⇧R/⌥⇧B/⌥F cover save/undo/redo/replay-all/bless-transcript/focus-search. Insert Parent and Splice Out deliberately have no accelerator - both are rare enough that a menu item is sufficient, matching Splice Out's own precedent in dialog-tool (which also has no shortcut for it, despite giving Insert Parent one - dialog-ide omits both).

#### Single-Keystroke Reply Widget
When the active knot's response ends on a keystroke prompt (`inputType: 'key'`), `render.ts`'s command input swaps to a 1-character field plus Enter/Space/Backspace buttons, rather than the normal free-text field. Unlike dialog-tool's own version (which relies on the deprecated `keypress` event, and so needs separate buttons as the *only* way to submit Enter/Backspace, since `keypress` never fires for either), this field's own `keydown` handler submits Enter and Backspace directly too - the buttons exist for discoverability and pointer users, not because they're the only path in.

On submit, `SkeinSession.runCommand` checks `tree.promptTypeAt(parentId)`: if `'key'`, the friendly reply text (`enter`/`space`/`backspace`, or a literal single character) is resolved to the actual byte(s) to send (`\n`/` `/`\b`, or the character unchanged) and written to the process with no trailing newline (dgdebug reads exactly one raw character); a normal line command is sent unchanged, newline-terminated, exactly as always. The friendly text, not the resolved byte(s), is what's stored as the knot's own `command` and written to the `.skein` file - see the persistence format's `prompt` field.

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
- `selectedChild`: Which child continues the currently selected path, or null if none/no children
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
  field: 'response' | 'label';
  snippet: string; // HTML-escaped, matched terms wrapped in <mark>, surrounding context included
}

interface SearchResults {
  results: SearchResult[]; // capped - see Full-Text Search's Implementation Notes
  totalMatches: number; // uncapped
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
- Runs over plain stdio pipes, like dgdebug - no pseudo-tty involved. dfrotz's `-r lt` flag puts it
  into the same tag-line batch mode `--tag-lines` gives dgdebug (see [Process
  Management](#4-process-management)), which is what makes plain pipes sufficient in the first
  place - a real terminal/pty is neither used nor needed for the managed Skein session path.
- Font and color handling for terminal output - deliberately **not** wired to real ANSI codes.
  `-f normal` (not `-f ansi`) is used unconditionally, so frotz sessions show plain text; this is
  flag-driven, not a pty limitation - frotz's dumb frontend has no `isatty()` check anywhere
  (verified against its own source, `dumb/doutput.c`). `-f ansi` was ruled out because it isn't
  just "the same output plus color codes": `show_cell_ansi()` special-cases every `'\n'` to print
  `"\x1b[0K\n"` (an Erase-in-Line sequence spliced between every line's content and its newline),
  and `will_print_blank()` returns `false` unconditionally in that mode, disabling frotz's own
  trailing-space trimming so every line pads out to the full screen width. Both would need
  stripping/tolerating in `IoDetector`'s tag-boundary detection before `-f ansi` could be used
  safely - not attempted, since it's a real parser risk for a purely cosmetic gain. Use `dgdebug`
  (`--formatting ansi`) to check bold/italic/color formatting; frotz sessions are for validating
  compiled zcode behavior, not formatting.
- Integration with the skein's ANSI formatting support (dgdebug only, per above)

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
This is not an IDE-original format — it's dialog-tool's actual on-disk skein format, verified directly against `dialog-tool`'s `skein/file.clj` and real `.skein` fixture files, so that files remain interchangeable between the two tools. It is a flat, line-oriented text file, not JSON, specifically so it diffs cleanly in a VCS.

#### Format Structure
```
seed: 42
engine: dgdebug
--------------------------------------------------------------------------------
id: 0
label: START
--------------------------------------------------------------------------------
The Featureless Space
An interactive fiction by The Intrepid Author.
...

--------------------------------------------------------------------------------
id: 1772224627854
parent-id: 0
command: i
--------------------------------------------------------------------------------
> i
You have no possessions.

```

#### File Header
- `key: value` lines appear before the first separator; order doesn't matter, both are optional per line
- `seed`: numeric, the RNG seed for the session
- `engine`: `dgdebug`, `frotz`, or `frotz-release`; defaults to `dgdebug` when the line is omitted entirely. This tool's writer emits the plain word, **without** a leading colon. Readers must still accept a leading colon, since dialog-tool's own writer emits `:dgdebug` (a Clojure keyword literal baked into the on-disk format by the reference implementation) and older files (or files also touched by dialog-tool) carry that form.
  - **Known upstream bug, and why we don't replicate its output form**: dialog-tool's own reader (`file.clj`'s `kv-re`, `#"(.+):\s*(.+)"`) is greedy on the key portion, so on a line like `engine: :dgdebug` it matches key = `"engine: "` (through the *second* colon) and value = `"dgdebug"` — that mangled key doesn't match `meta-parsers`' `"engine"` entry, so the field is silently dropped. Confirmed empirically: loading dialog-tool's own real `test-fixtures/dgsample/default.skein` through its own `read-tree` yields `nil` for `:engine`, and dialog-tool has no test covering this round-trip. Every dialog-tool-written file with an `engine:` line is affected the same way when read back by dialog-tool itself. This IDE's `persistence.ts` parses either form correctly (see `normalizeEngine`), but earlier deliberately still *wrote* the colon form for interchangeability - since that form is unreadable by dialog-tool itself anyway, there's no interchangeability upside to keeping it, only the downside of perpetuating a bug into freshly-written files. The writer now emits the plain word instead; the colon is still accepted on read, as a workaround, not replicated on write.
- No comment lines (`#`) are used

#### Separators
Two distinct separator lines, each exactly 80 characters, are used:
- Knot delimiter: eighty `-` characters, written between the header and the first knot, between each knot's key/value block and its response content, and between one knot's content and the next knot's key/value block. On read, treat any line of 4 or more `-` characters as this separator (the reference writer always emits exactly 80, but is lenient on read).
- Unblessed-response delimiter: eighty `<` characters. Appears within a knot's content section, after the blessed response text, to introduce the unblessed (pending/unverified) response text. Same 4-or-more leniency on read. **Not** `>>>>` — despite similar specs elsewhere describing it that way, the actual character is `<`.

#### Knot Structure
Each knot is:
1. A separator line
2. Key/value pairs for the knot's properties (order as written by the reference: `id`, `label`, `locked`, `parent-id`, `command`, `prompt` — any absent/nil field is simply omitted, not written as empty)
3. Another separator line
4. The blessed response text, verbatim (no `response:` key — it's just the raw content up to the next delimiter). The reference implementation guarantees this text ends with a trailing newline.
5. Optionally, the unblessed-response delimiter followed by the raw unblessed response text, on the same terms

#### Knot Properties
- `id`: numeric knot identifier. Not small sequential integers — seeded from wall-clock time (milliseconds since epoch) and incremented by one per knot within the same session, except the root, which is always `0`
- `label`: optional descriptive label; the root knot's label is always written as `START`
- `locked`: only written as `locked: true` when the knot is locked; omitted (defaults false) otherwise
- `parent-id`: reference to the parent knot; omitted for the root knot (which has none)
- `command`: player input text; omitted for the root knot (the root has no command — its `label` of `START` is what identifies it, not a fabricated command string)
- `prompt`: only written as `prompt: keystroke` when the knot's prompt is a keystroke prompt; omitted (defaults to a line prompt) otherwise. Note the file's field is `prompt` with values `line`/`keystroke`, not the in-memory `Response.inputType` field name/values (`'line' | 'key'`) — a translation happens at the persistence boundary, not a renamed passthrough.

#### Round-Tripping WireKnot's Split Response
`WireKnot` (see [Data Models](#1-skein-knot-model)) tracks `response` and `unblessedResponse` as two independent `{text, inputType}` values, but the file format has only one `prompt` field per knot. When writing, prefer `unblessedResponse.inputType` (the more current value) and fall back to `response.inputType`, defaulting to `'line'` if neither is present. When reading, the single `prompt` value is applied to both `response` and `unblessedResponse` if both are present in the file — in the (currently theoretical) case where a knot's blessed and unblessed responses actually have different prompt types, that distinction doesn't survive a save/load round-trip. That's a known, accepted limitation of matching dialog-tool's format rather than inventing an incompatible extension.

#### Loading and Tree Reconstruction
The file only stores the flat list of knots (via `id`/`parent-id`); it does not store computed structure like each parent's children list or which child is selected. On load, that has to be rebuilt: group knots by `parent-id` to get each parent's `children`, and set each parent's `selectedChild` to the first child encountered when knots are processed in ascending `id` order (matching dialog-tool's `rebuild`, which does the same from the file's guaranteed ascending write order).

#### Notes
- Knots are always written in ascending order by knot id
- Knot ids are numeric with a soft guarantee that larger numbers represent a later point in time
- Knot ids do not have to be purely sequential (they are seeded from wall clock time, then increment by one)
- Saves are atomic: write to a temp file, then rename over the target — never write the target path directly
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
- Setting or clearing a label (a labeled knot is also treated as locked - see below - even if never explicitly locked)
- Locking or unlocking (locked or labeled knots cannot be deleted)
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
- **Bundle Size**: For the VS Code extension, minimize impact on overall bundle size

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
- dgdebug debugger integration - covered by `dgdebug-integration.spec.ts`, which spawns the real dgdebug binary (project.ts -> session.ts/process.ts -> io.ts/dynamic.ts, nothing mocked) against a real fixture project; it skips itself when dgdebug isn't on PATH rather than failing, so it stays portable to machines/CI without the Dialog toolchain installed
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