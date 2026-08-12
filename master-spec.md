# Dialog IDE Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Implementation Status](#implementation-status)
3. [Project Structure](#project-structure)
4. [Core Functionality](#core-functionality)
5. [Editor Interface](#editor-interface)
6. [Skein Interface](#skein-interface)
7. [File Formats](#file-formats)
8. [Integration Points](#integration-points)
9. [Features and Menus](#features-and-menus)
10. [Technical Implementation](#technical-implementation)
11. [Test Plan](#test-plan)
12. [Compatibility Requirements](#compatibility-requirements)

## Introduction

This specification defines a cross-platform Integrated Development Environment (IDE) for the Dialog programming language. The IDE supports both editing mode and skein execution mode, providing enhanced functionality for Dialog development.

The IDE is designed to work seamlessly with the Dialog ecosystem, with particular emphasis on the skein-based development workflow that is central to modern Dialog project creation and testing.

## Implementation Status

This document describes the full product vision; `technical-design.md` tracks what's actually built (see its own per-component detail, including a "Current status" note wherever something below is genuinely incomplete). At a glance:

**Built, as this extension** (matches the [Skein Interface](#skein-interface) section closely): the navigation graph, transcript view, keyboard-first navigation, blessing, replay (single-knot and full-tree), undo/redo, time travel, tracing and dynamic-state display as non-modal integrated panels (not dialogs), full-text search, single-keystroke input handling, and `.skein`/`dialog.json` file compatibility with dialog-tool.

**Delegated to other tools, not implemented by this extension at all**: everything in [Editor Interface](#editor-interface) - `.dg` syntax highlighting, code folding, bracket matching, auto-completion, and the outline/cross-file-navigation view are the separate `sideburns3000.dialog-language-support` extension's responsibility (declared as an `extensionDependencies` entry), not this one's. Source file editing itself happens in VS Code's own built-in text editor and Explorer view - this extension contributes no custom editor, tabs, or file tree. There's also no custom File/Edit/View/Build/Tools menu bar as such a thing doesn't exist for VS Code extensions; where an equivalent exists it's a Command Palette entry or a context-menu item instead, and "Mode Switching" between editing and skein execution is just normal VS Code window/tab management, not a dedicated toggle.

**Not yet implemented, by anyone**: project-level source file creation/deletion from within the IDE; `dialogc` build/export integration (including the aambundle web-bundle workflow); the Test Runner described under [Tools Menu](#tools-menu); and running the `frotz`/`frotz-release` engines (only `dgdebug` is wired up at the session layer today - see `technical-design.md`'s Process Management section). Dark/light theme auto-switching *is* implemented, following the OS/VS Code preference.

## Project Structure

### Directory Layout
```
project-root/
├── src/                    # Main source files (.dg)
├── lib/                    # Libraries and extensions
├── tests/                  # Test files
├── out/                    # Build outputs
├── dialog.json             # IDE configuration (replaces dialog.edn)
├── Makefile                # Build instructions (optional, for compatibility)
└── default.skein           # Default skein file
```

### Configuration File (dialog.json)

The IDE uses a JSON format configuration file instead of EDN, designed to be more suitable for TypeScript implementation and easier to maintain programmatically:

```json
{
  "name": "project-name",
  "version": "1.0.0",
  "sources": [
    {
      "path": "src/main.dg",
      "category": "main"
    },
    {
      "path": "src/scene1.dg",
      "category": "main"
    },
    {
      "path": "lib/debug/debug_util.dg",
      "category": "debug"
    },
    {
      "path": "lib/common.dg",
      "category": "library"
    },
    {
      "path": "lib/dialog/core.dg",
      "category": "library"
    },
    {
      "path": "lib/dialog/stdlib.dg",
      "category": "library"
    },
    {
      "path": "lib/dialog/stddebug.dg",
      "category": "library"
    }
  ],
  "build": {
    "targets": ["z8", "aa"],
    "options": {
      "zblorb": [
        "--cover",
        "cover.png",
        "--cover-alt",
        "Project Cover"
      ],
      "aa": [
        "--heap",
        "2000"
      ]
    }
  }
}
```

## Core Functionality

### Project Management
- **Project Loading**: Load projects from directory structure with dialog.json
- **File Organization**: Automatic handling of compilation order based on configuration
- **Source Path Management**: Support for main, debug, test, and library directories
- **File Creation/Deletion**: Ability to create and delete source files within the project
- **Compilation Order**: Proper ordering of source files (project-specific sources first, then debug-only sources, lastly libraries including Dialog's standard library)
- **Build Configuration**: Handle multiple target formats (Z-machine, Å-machine)

### Build System Integration
- **Direct Compilation**: Integration with dialogc compiler for building projects
- **Packaging**: Export functionality that wraps dialogc compiler
- **Change Detection**: Real-time detection of code changes during skein execution
- **Error Reporting**: Clear visual feedback on build success/failure

### Editor Features
- **Syntax Highlighting**: Dialog (.dg) file syntax highlighting
- **Outline View**: Fast navigation to object topic definitions (lines with object names like #magic-wand on their own line)
- **Cross-File Navigation**: Quick jump to any object definition by name across all source files in the project
- **Find/Replace**: With regex support and multi-file search
- **Auto-completion**: For Dialog predicates, built-ins, and keywords

## Editor Interface

### Layout Structure
The editor interface displays:
- **Left Panel**: File hierarchy tree (project explorer)
- **Right Panel**: Open file editors with active editing area

### Key Features
1. **File Navigation**:
   - Expandable/collapsible directory structure
   - File type indicators (.dg, .json, etc.)
   - Quick file search functionality

2. **Editor Window**:
   - Multiple tabbed editors
   - Syntax highlighting for Dialog files
   - Line numbers and bracket matching
   - Code folding capabilities

3. **Switching Between Modes**:
   - Easy toggle between editing and execution modes
   - Preserved editor state during mode switching
   - Quick access to both interfaces

## Skein Interface

The skein interface is a core component of the Dialog IDE that provides an interactive debugging and testing environment for Dialog projects. It allows developers to explore different paths through their interactive fiction, test various player choices, and understand how their code responds to different inputs.

### What is a Skein?
A skein in Dialog development represents an interactive narrative tree where each node (called a "knot") corresponds to a specific command entered by the player and the resulting game response. The skein captures all possible paths through the story, allowing developers to:
- Test multiple player choices simultaneously
- Time-travel back to previous states to test alternative approaches
- Verify that code changes don't break existing functionality
- Document how the interactive fiction behaves under different conditions

### Key Skein Concepts

1. **Knots**: Individual nodes in the skein representing a specific command and its response
2. **Branching**: When multiple choices are possible from a single point, the skein branches into multiple paths
3. **Time Travel**: The ability to return to any previous knot and enter different commands
4. **Blessing**: Marking a knot's response as correct/valid so it doesn't need to be replayed
5. **Replay All**: Running through all possible paths in the skein to verify changes

### Skein Structure
- Each knot contains: command input, game response, and metadata about the execution
- Knots are organized in a tree structure with parent-child relationships
- The "active" knot is highlighted in blue and represents the current position in the story
- Knots can be colored to indicate their state: new (yellow), valid (grey), or error (red)
- Special handling for single-key input points where the game expects a specific keystroke
- ANSI font/color information from dgdebug execution is captured and preserved in skein files
- UI presents ANSI formatting reasonably while maintaining readability
- Support for fixed-width vs proportional text rendering as appropriate

### Layout Structure
The skein interface displays:
- **Left Panel**: Navigation graph showing knot relationships
- **Right Panel**: Transcript view showing player commands and game responses

### Key Features
1. **Navigation Graph**:
   - Visual representation of story flow and branching
   - Color-coded knots (blue for active, grey for spine, yellow for new, red for errors)
   - Collapsible/expandable subtrees
   - Node selection and navigation

2. **Transcript View**:
   - Linear sequence of player commands and game responses
   - Clear distinction between different knot states
   - Search functionality within transcript
   - Command input field for entering new commands

3. **Toolbar Operations**:
   - Knot blessing (accepting changes)
   - Replay functionality 
   - Time travel capabilities
   - Knot editing and deletion
   - Undo/redo operations

### Skein Workflow Goals
The skein interface is designed to support the following key development workflows:

1. **Exploratory Development**: Developers can test different player choices and see how the story responds, allowing for iterative design of interactive fiction narratives.

2. **Debugging and Testing**: The ability to time-travel back to previous states allows developers to test specific scenarios and debug complex interactions without starting over.

3. **Verification**: The ability to replay all paths in a skein ensures that changes to source code don't break existing functionality, providing confidence in code modifications.

4. **Documentation**: Skeins serve as living documentation of how a Dialog project behaves under various conditions, with each knot representing a specific path through the story.

5. **Real-time Code Navigation**: Clicking on source file references in the skein transcript will automatically open the editor to that file and line, enabling rapid debugging and code exploration.

6. **Keyboard-First Operation**: The interface is optimized for mouse-free operation with comprehensive keyboard shortcuts for all functions, following dialog-tool's design pattern of efficient arrow-based navigation and keyboard accelerators.

7. **Non-Modal Interface Design**: Where appropriate, the IDE avoids excessive use of modal dialogs that interrupt workflow. Instead, features like trace view and dynamic state display are implemented as integrated editor tabs or panes to maintain seamless development flow while still providing access to debugging information.

### Mode Switching
- **Edit Mode**: File hierarchy on left, editor windows on right
- **Execute Mode**: Navigation graph on left, transcript view on right
- **Smooth Transition**: Quick switching between modes with preserved state

### Skein File Format Compatibility
While the IDE maintains compatibility with existing skein file formats for backward compatibility, the core skein functionality is designed to work optimally within the Dialog IDE environment. The text-based format ensures that skeins can be easily version-controlled and reviewed through standard VCS diff tools.

## File Formats

### Configuration Format (dialog.json)
The IDE uses JSON format for configuration files:
- **Structure**: Clear hierarchical organization with source lists as ordered maps
- **Maintainability**: Easier to programmatically generate and modify
- **Type Safety**: Better integration with TypeScript type checking

### Skein File Format (Text-based)
The IDE maintains full compatibility with text-based skein file formats:
- **Format**: Text representation designed for VCS diff review
- **Novelty**: Knot IDs allocated to accumulate novelty at the end for better diffs
- **Structure**: Preserves all existing functionality from dialog-tool
- **Compatibility**: Full backward compatibility maintained

## Integration Points

### Tool Integration
1. **dialogc Compiler**:
   - Direct execution capabilities
   - Build process integration
   - Error handling and reporting

2. **dgdebug Debugger**:
   - Native integration with debugging sessions
   - Breakpoint support
   - Debug output display

3. **frotz Engine**:
   - Support for alternative debugging approaches
   - Pseudo-tty usage for ANSI output generation
   - Font and color handling for terminal output

4. **aambundle Command**:
   - Integration for creating web interpreters
   - Packaging of projects for web deployment
   - Export workflow enhancement

### External Integration
1. **Version Control Systems**:
   - Skein file diff support
   - Git integration for project management
   - Change tracking across files

2. **Build Tools**:
   - Makefile compatibility (optional)
   - Direct compiler integration
   - Packaging workflows

## Features and Menus

### File Menu
- **New Project**: Create new Dialog project
- **Open Project**: Load existing project
- **Save**: Save current project
- **Close**: Close current project
- **Import**: Import external projects

### Edit Menu
- **Undo/Redo**: Undo and redo operations
- **Cut/Copy/Paste**: Text manipulation
- **Find/Replace**: Search functionality
- **Go To**: Navigate to specific lines or symbols
- **Preferences**: IDE configuration settings

### View Menu
- **Toggle Editor Mode**: Switch between editing and execution modes
- **Full Screen**: Toggle full-screen view
- **Theme**: Change color scheme
- **Font Size**: Adjust text sizing

### Build Menu
- **Build Project**: Compile project sources
- **Run**: Execute compiled project
- **Debug**: Launch debugger session
- **Export**: Package project for distribution
- **Clean**: Clean build artifacts

### Skein Menu
- **New Skein**: Create new skein file
- **Open Skein**: Load existing skein
- **Save Skein**: Save current skein
- **Replay All**: Execute all paths in skein
- **Bless Knot**: Accept changes for current knot
- **Bless Changes**: Accept changes for visible path

### Tools Menu
- **Run dgdebug**: Launch debugger window
- **Run frotz**: Launch frotz engine
- **Test**: Run project tests
- **Profile**: Performance analysis tools

## Technical Implementation

### Architecture
1. **Frontend Framework**:
   - VS Code extension, hosting the Skein UI in a webview panel
   - TypeScript for type safety
   - Datastar for reactive UI components

2. **Data Structures**:
   - Skein knot tree implementation optimized for TypeScript
   - Persistent data structures for undo/redo functionality
   - Performance optimization for large skein files

3. **Integration Layer**:
   - Direct execution of dialogc and dgdebug binaries
   - Process management for external tools
   - Communication protocols between IDE and Dialog tools

### Theme Support
- **Dark Mode**: Full dark theme support with appropriate color schemes for code editing and skein visualization
- **Light Mode**: Standard light theme optimized for readability
- **Automatic Switching**: System preference detection and automatic theme switching
- **Customization**: User-configurable theme settings and color schemes
- **Consistent UI**: Theme consistency across all interface components including editors, graphs, and dialogs

### Skein Implementation
1. **Tree Structure**:
   - Optimized for TypeScript persistent data handling
   - Efficient node operations
   - Memory management for large graphs

2. **Undo/Redo System**:
   - Integration with TypeScript persistent data structures
   - Performance considerations for large skeins
   - Compatibility with dialog-tool's approach

3. **Persistence**:
   - Text-based file format preservation
   - Diff-friendly ID allocation system
   - Version control compatibility

### Datastar Integration
1. **UI Components**:
   - Reactive skein visualization
   - Dynamic editor interface
   - Real-time feedback mechanisms

2. **State Management**:
   - Component-level state handling
   - Data binding for UI elements
   - Performance optimization for large datasets

## Test Plan

### Unit Testing Layers

#### 1. Skein File Read/Write Operations
- **File Format Validation**: Verify parsing of existing skein files
- **Serialization Tests**: Ensure proper output format generation
- **Edge Case Handling**: Test malformed or incomplete files
- **Performance Tests**: Measure read/write performance for large files

#### 2. Persistent Knot Tree Manipulation
- **Tree Operations**: Insert, delete, update knots
- **Navigation Tests**: Path traversal and selection
- **State Consistency**: Verify tree integrity during operations
- **Undo/Redo Functionality**: Test change tracking and restoration

#### 3. Editor Features
- **Syntax Highlighting**: Validate tokenization and coloring
- **Find/Replace**: Test search and replacement functionality
- **Code Folding**: Verify folding behavior for various constructs
- **Auto-completion**: Test prediction accuracy and performance

#### 4. Build System Integration
- **Compiler Execution**: Verify dialogc integration
- **Build Process**: Test compilation workflows
- **Error Handling**: Validate error reporting mechanisms
- **Incremental Builds**: Test change detection and partial builds

### Integration Testing

#### 1. Tool Integration
- **dgdebug Launch**: Verify debugger execution
- **frotz Integration**: Test alternative engine support
- **Process Management**: Validate external tool communication

#### 2. File System Operations
- **Project Loading**: Test various project configurations
- **File Changes**: Verify real-time updates
- **Save/Load**: Validate persistence mechanisms

### Compatibility Testing

#### 1. Backward Compatibility
- **Skein Format**: Ensure compatibility with existing files
- **Configuration Format**: Test dialog.json against legacy dialog.edn
- **Workflow Preservation**: Maintain existing development workflows

#### 2. Cross-Platform
- **Windows Support**: Verify Windows functionality
- **macOS Support**: Test macOS compatibility
- **Linux Support**: Validate Linux installation and operation

## Compatibility Requirements

### Existing Project Compatibility
1. **Skein Files**: Full backward compatibility maintained
2. **Source Structure**: Follows established Dialog conventions
3. **Build Process**: Works with existing Makefiles (optional)
4. **Tool Integration**: Compatible with dialogc, dgdebug, and frotz

### Workflow Preservation
1. **Development Flow**: Maintain existing skein-based development approach
2. **Debugging**: Support both direct dgdebug usage and skein integration
3. **Version Control**: Optimize for VCS diff review capabilities
4. **Project Organization**: Align with established Dialog project patterns

### Future Extensibility
1. **Plugin Architecture**: Support for additional tools and features
2. **Configuration Flexibility**: Adapt to evolving Dialog ecosystem needs
3. **Performance Optimization**: Scalable design for large projects
4. **Cross-Platform Support**: Consistent experience across operating systems

This specification provides a comprehensive foundation for developing a Dialog IDE that maintains full compatibility with existing Dialog workflows while providing enhanced development capabilities and a modern, efficient user interface.