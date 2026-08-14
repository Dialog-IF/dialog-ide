# Dialog IDE

Dialog IDE is a VS Code extension for developing interactive fiction in the [Dialog](https://github.com/dialog-if/dialog) programming language. Its centerpiece is the **Skein**: an interactive, web-style panel for running, testing, and debugging your project without leaving the editor.

> [!NOTE]
> Not every work of IF is a "game", so the Dialog tooling generally says "project" instead.

## What the Skein does

At its simplest, the Skein is a live wrapper around Dialog's own debugger (`dgdebug`): you type player commands, and the project's responses come back into the panel. What makes it powerful is that it *remembers*. Every command and response you've ever tried is kept in an ever-growing tree, so you can:

- **Time travel** back to any earlier point and try a different command, without losing the path you already explored
- **Bless** a response as correct, so you'll be warned if a later code change ever produces a different response
- **Replay All** every path through your project in seconds, to confirm a change didn't break anything
- **Trace** exactly which predicates fired for a given command, with clickable links to the source
- Inspect the **dynamic state** (flags, relations, attributes) that changed as a result of a command

Each command/response pair is called a **knot**. Knots form a tree - the same command can appear at multiple points in the tree, each with its own knot, because the same input can mean something different depending on what came before.

## Requirements

- On Windows, Apple Silicon Macs, and Linux (x64): nothing extra - the Dialog toolchain (`dgdebug`) is bundled with the extension and just works.
- On other platforms (Intel Macs, Linux ARM, etc.): install the [Dialog toolchain](https://github.com/dialog-if/dialog) yourself, with `dgdebug` on your `PATH`, or point `dialog.json`'s `binDir` at it (see [Project Setup](#project-setup))
- A project folder containing a `dialog.json` file (see [Project Setup](#project-setup))

`.dg` syntax highlighting, folding, and bracket/indentation support are built in, along with an Outline view (and breadcrumbs, ⌘⇧O / Ctrl+Shift+O) and workspace-wide "Go to Symbol" (⌘T / Ctrl+T) across every `.dg` file in the project. Dialog IDE itself doesn't otherwise touch source editing; it's all about running the project through the Skein.

> [!NOTE]
> If you previously had the separate [`dialog-language-support`](https://marketplace.visualstudio.com/items?itemName=sideburns3000.dialog-language-support) extension installed, Dialog IDE will warn you once at startup and suggest disabling or uninstalling it - having both installed can cause inconsistent `.dg` highlighting and a duplicate "Compile to..." context menu.

## Installing

Search for **Dialog IDE** in the VS Code Extensions view and install it, or install from the command line:

```bash
code --install-extension hlship.dialog-ide
```

## Project Setup

Dialog IDE reads a `dialog.json` file at the root of your project (opened as a VS Code workspace folder):

```json
{
  "name": "my-project",
  "sources": {
    "main": ["src"],
    "test": ["test"],
    "debug": ["lib/dialog/debug"],
    "library": ["lib/dialog"]
  }
}
```

- Each entry under `sources` is a list of directories (all `.dg` files in the directory) or individual file paths
- `main` is always included; `debug` is pulled in for Skein/debug sessions; `library` (including the Dialog standard library) is always included; `test` is recognized as a project source today but isn't loaded by a running Skein session yet - reserved for a planned Test Runner
- Order is very important: main comes before test, which comes before debug, which comes before library.

The order of sources in a single directory is not guaranteed; if order counts, you should list the files in the directory
in the order you need them to be.  Remember that Dialog searches for rules top to bottom, so you should have 
exceptions first, before default rules.

If you create a `.dg` file that isn't covered by any of the categories above, Dialog IDE flags it - a dismissible notification plus a persistent Explorer badge, both with a one-click "Add to dialog.json" fix. Turn this off via the `dialog-ide.warnOnUncoveredSource` setting.

If you need a specific `dgdebug` (e.g. a locally built one, or a platform Dialog IDE doesn't bundle a toolchain for - see [Requirements](#requirements)), add a `binDir` field pointing at the directory containing it:

```json
{
  "name": "my-project",
  "binDir": "/opt/dialog/bin",
  "sources": { "main": ["src"] }
}
```

`binDir` always takes priority, overriding both Dialog IDE's bundled toolchain and anything found on `PATH`.

## Getting Started

Open your project folder in VS Code, then use the Command Palette (⌘⇧P / Ctrl+Shift+P) for:

| Command | Effect |
|---|---|
| **Dialog IDE: New Skein...** | Create a new `.skein` file (prompts for a random seed and file name) |
| **Dialog IDE: Run Default Skein** | Run `default.skein` if one already exists |
| **Dialog IDE: Run Skein...** | Pick from any existing `.skein` file in the project |
| **Dialog IDE: Open Skein** | Reveal the Skein panel for whatever session is currently running |
| **Dialog IDE: Save Skein** | Save the current session's tree back to its `.skein` file |
| **Dialog IDE: Stop Skein** | Stop the running session |
| **Dialog IDE: Debug in Terminal** | Open a plain, unmanaged `dgdebug` session in a VS Code terminal |
| **Dialog IDE: Add File to dialog.json...** | Add the current (or a picked) `.dg` file to one of dialog.json's source categories |

A status bar item on the left also shows the current session (or lets you start the default one with a click).

`.skein` files are plain text, designed to diff cleanly under version control - commit them alongside your source.

## Using the Skein

The Skein panel opens beside your editor, split into a **nav graph** (left) and a **transcript** (right), with a command field at the bottom.

**Transcript.** Each knot shows a command and its response. The active knot (the one you're positioned at) has a blue left border. Others are colored by status:

| Color | Meaning |
|---|---|
| Grey | Valid - matches the blessed response |
| Yellow | New - no blessed response yet |
| Red | In error - the latest response doesn't match what's blessed |

New or errored knots are shown in a fixed-width font with visible whitespace, and word-level diffs (red for removed, blue for added) when a response has changed.

**Nav graph.** The full tree of every knot you've ever explored, color-coded the same way (with faded tinting on ancestors that have a new/errored descendant, so you can spot trouble without expanding every branch). Click any knot to make it active; the transcript updates to show the path down to it. Clicking through a chain with only one child at each step auto-expands down to the next branch or leaf.

**Blessing.** *Bless Knot* accepts that the active knot's response is correct; *Bless Transcript* blesses every knot visible in the transcript. Once blessed, a knot turns from new/error to valid.

**Replaying.** *Replay* re-runs the project from the root through the active knot and checks each response against what's blessed - the fast way to confirm a source change did what you intended. *Replay All* does this for every leaf in the tree at once, so you know the *entire* skein still holds together, not just the path you happen to be looking at.

**Time travel.** Click any earlier knot, then *New Child* to branch off with a different command from that point - nothing you already recorded is lost, it's just no longer on the displayed path.

**Trace and Dynamic State** (dgdebug only). From a knot's action menu, *Trace...* (also ⌥T) shows which predicates were tried, in what order, and why, with clickable links into your source; *Dynamic State...* shows exactly what changed in the game world as a result of that command. A navbar toggle can also switch on an always-visible summary of dynamic state changes, which are displayed inline in the transcript (after each knot).

## Keyboard shortcuts

The Skein is designed to be fully usable without a mouse (all shortcuts below are Option/⌥ on Mac, Alt on Windows/Linux):

| Shortcut | Action |
|---|---|
| ⌥↑ / ⌥↓ | Parent / child knot |
| ⌥← / ⌥→ | Previous / next sibling |
| ⌥⇧↑ / ⌥⇧↓ | First knot (root) / last knot (leaf) |
| ⌥B / ⌥⇧B | Bless Knot / Bless Transcript |
| ⌥R / ⌥⇧R | Replay to active knot / Replay All |
| ⌥A | New Child (time travel) |
| ⌥E | Edit Command |
| ⌥L | Edit Label |
| ⌥K | Toggle Lock |
| ⌥D | Delete |
| ⌥X | Toggle Expand (nav graph) |
| ⌥T | Trace... |
| ⌥F | Focus search |
| ⌘S / ⌘Z / ⌘⇧Z | Save / Undo / Redo |

Insert Parent and Splice Out are available from a knot's action menu but have no keyboard accelerator.

Undo/redo is unlimited and covers structural edits (bless, delete, splice, running a new command); it doesn't re-run anything, so it's always instant.

## Known limitations

- Only the `dgdebug` engine is runnable today - `frotz`/`frotz-release` are offered as engine choices when creating a skein, but selecting either just explains they're not implemented yet
- No "Reload from disk" action yet for picking up external changes to a `.skein` file
- Dynamic state and tracing require `dgdebug`, and are unavailable for a command that ends on a single-keystroke prompt (the debugger can't be interrupted mid-keystroke to ask for either)

## Future Improvements

This is an early alpha release of the extension; we have many more features planned, including:

- A new project wizard
- An export wizard to build a playable .zblorb file, or package the game for distribution
- A Test Runner for the `test` source category

Get involved at [Interactive Fiction Community Forum](https://intfiction.org/t/dialog-ide-0-0-1/81465/7) to provide feedback and ideas!

## License

[Apache License 2.0](LICENSE). The vendored `.dg` TextMate grammar and language configuration are separately MIT-licensed - see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
