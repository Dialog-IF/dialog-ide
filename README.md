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

- On Windows, Apple Silicon Macs, and Linux (x64): nothing extra - the Dialog toolchain (`dgdebug`, `dialogc`) and [AAmachine](https://github.com/dialog-if/aamachine) (`aambundle`) are bundled with the extension and just work.
- On other platforms (Intel Macs, Linux ARM, etc.): install the [Dialog toolchain](https://github.com/dialog-if/dialog) yourself, with `dgdebug`/`dialogc` on your `PATH`, or point `dialog.json`'s `binDir` at it (see [Project Setup](#project-setup)). **Export Web Page...** additionally needs `aambundle` from [AAmachine](https://github.com/dialog-if/aamachine) on your `PATH`/`binDir` - the other commands don't need it.
- Running a skein with the `frotz`/`frotz-release` engine additionally needs `dfrotz` (from [frotz](https://gitlab.com/DavidGriffith/frotz)) on your `PATH`/`binDir`, on every platform - it isn't bundled yet.
- A project folder containing a `dialog.json` file (see [Project Setup](#project-setup)) - or use **Dialog IDE: Initialize Dialog Project** to create one from scratch

`.dg` syntax highlighting, folding, and bracket/indentation support are built in, along with an Outline view (and breadcrumbs, ⌘⇧O / Ctrl+Shift+O) and workspace-wide "Go to Symbol" (⌘T / Ctrl+T) across every `.dg` file in the project. Dialog IDE itself doesn't otherwise touch source editing; it's all about running the project through the Skein.

> [!NOTE]
> If you previously had the separate [`dialog-language-support`](https://marketplace.visualstudio.com/items?itemName=sideburns3000.dialog-language-support) extension installed, Dialog IDE will warn you once at startup and suggest disabling or uninstalling it - having both installed can cause inconsistent `.dg` highlighting and a duplicate "Compile to..." context menu.

## Installing

Search for **Dialog IDE** in the VS Code Extensions view and install it, or install from the command line:

```bash
code --install-extension hlship.dialog-ide
```

## Project Setup

Dialog IDE reads a `dialog.json` file at the root of your project (opened as a VS Code workspace folder). This is what **Dialog IDE: Initialize Dialog Project** scaffolds:

```json
{
  "name": "my-project",
  "sources": {
    "main": ["main"],
    "test": ["test", "lib/unit.dg"],
    "debug": ["debug", "lib/stddebug.dg"],
    "library": ["lib/stdlib.dg"]
  }
}
```

- Each entry under `sources` is a list of directories (all `.dg` files in the directory) or individual file paths
- `main` is always included; `debug` is pulled in for Skein/debug sessions; `library` (including the Dialog standard library) is always included; `test` is loaded by **Dialog IDE: Run Tests** (see [Getting Started](#getting-started)), but not by a running Skein session
- Order is very important: main comes before test, which comes before debug, which comes before library.

The order of sources in a single directory is not guaranteed; if order counts, you should list the files in the directory
in the order you need them to be.  Remember that Dialog searches for rules top to bottom, so you should have 
exceptions first, before default rules.

A source file named `<name>.<format>.dg` is only included when building for that format - e.g. `colors.zblorb.dg` is
included in a `zblorb` export but skipped everywhere else, and `layout.dgdebug.dg` is included only when running a
Skein session, **Debug in Terminal**, or **Run Tests** (all of which run against `dgdebug`). This lets you fine-tune
things like colors or layout per format without those tweaks leaking into other builds. A file with no such suffix
(or one that doesn't match any format Dialog IDE builds for) is always included.

If you create a `.dg` file that isn't covered by any of the categories above, Dialog IDE flags it - a dismissible notification plus a persistent Explorer badge, both with a one-click "Add to dialog.json" fix. Turn this off via the `dialog-ide.warnOnUncoveredSource` setting.

Dialog IDE also flags a source file declared in more than one category (or twice in the same one) - since order matters, a duplicate isn't harmless, it's compiled twice. Turn this off via the `dialog-ide.warnOnDuplicateSource` setting.

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
| **Dialog IDE: Initialize Dialog Project** | Scaffold a new project into an empty folder: `dialog.json`, `main`/`lib`/`debug`/`test` directories, starter source, a placeholder `cover.png`, and the two "how to play IF" PDFs used by **Export Web Page...** |
| **Dialog IDE: New Skein...** | Create a new `.skein` file (prompts for a random seed and file name) |
| **Dialog IDE: Run Default Skein** | Run `default.skein` if one already exists |
| **Dialog IDE: Run Skein...** | Pick from any existing `.skein` file in the project |
| **Dialog IDE: Open Skein** | Reveal the Skein panel for whatever session is currently running |
| **Dialog IDE: Save Skein** | Save the current session's tree back to its `.skein` file |
| **Dialog IDE: Stop Skein** | Stop the running session |
| **Dialog IDE: Debug in Terminal** | Open a plain, unmanaged `dgdebug` session in a VS Code terminal |
| **Dialog IDE: Run Tests** | Run the project's unit tests (the `test` source category) in a VS Code terminal |
| **Dialog IDE: Add File to dialog.json...** | Add the current (or a picked) `.dg` file to one of dialog.json's source categories |
| **Dialog IDE: Configure Exports...** | Define named export configurations, and the project's default `dialogc` options (see [Building & Exporting](#building--exporting)) |
| **Dialog IDE: Export Dialog Project...** | Compile one of those export configurations |
| **Dialog IDE: Export Web Page...** | Build a downloadable web page for the project, with an in-browser player |
| **Dialog IDE: Add Feelie...** | Add an attachment (e.g. a PDF) that **Export Web Page...** links from the page |
| **Dialog IDE: Remove Feelie...** | Remove a previously added feelie |

A status bar item on the left also shows the current session (or lets you start the default one with a click).

**Dialog IDE: Run Tests** compiles with the `main`, `debug`, and `test` categories all active and runs `dgdebug` in a terminal - `test`'s own `lib/unit.dg` (see [Project Setup](#project-setup)) overrides `(program entry point)` to run every object with the `(test *)` trait instead of starting the game. Once the tests finish, dgdebug drops into its own `suspended>` debug prompt rather than quitting automatically, so the pass/fail output stays on screen - exit it yourself (`@quit` or Ctrl+D) once you've read the results. See the "Testing and Debugging" chapter of the Dialog manual (bundled with the [Dialog toolchain](https://github.com/dialog-if/dialog)'s own docs) for how to write `(test *)`/`(assert ...)` objects.

`.skein` files are plain text, designed to diff cleanly under version control - commit them alongside your source.

## Building & Exporting

**Dialog IDE: Configure Exports...** defines named export configurations, stored in `dialog.json`'s `exports` array: an output format (`zblorb`, `z8`, or `aa`), whether to include debug sources, an output path, and (optionally) extra `dialogc` options for that export specifically (e.g. `--heap 2000 --aux 1000`, for a project that needs a bigger heap). The same menu also sets a project-wide *default* set of `dialogc` options, used by any export configuration that doesn't specify its own, and by **Export Web Page...** (below).

**Dialog IDE: Export Dialog Project...** picks one of those configurations and compiles it with `dialogc`.

**Cover image.** If a `cover.png` exists at your project root (seeded automatically by **Initialize Dialog Project**, or add your own), a `zblorb` export bakes it in automatically via `dialogc`'s `--cover`/`--cover-alt` flags - no configuration needed.

**Dialog IDE: Export Web Page...** asks which of `dialog.json`'s named export configurations should build the downloadable story file (same picker as **Export Dialog Project...**), then builds a complete web page into `out/web/` (plus a zip at `out/<name>-<release>.zip`): that configuration's story file, compiled fresh with its own format/debug/`dialogc`-options settings; an in-browser player powered by [AAmachine](https://github.com/dialog-if/aamachine) (built separately as `aa`, unless the picked configuration is itself `aa`, in which case that same build drives both); the cover image, resized to a thumbnail; the project's configured feelies (below); and, if `default.skein` has a knot labeled `WALKTHROUGH`, a walkthrough transcript (everything from the root to that knot, skipping any command starting with `*`). Story title/author/blurb/release/IFID on the page come from the project's own `(story ...)` directives, queried live via `dgdebug`. Directs to **Configure Exports...** first if no export configurations are defined yet.

**Feelies.** A feelie is any attachment linked from the exported page - traditionally a "how to play interactive fiction" PDF for newcomers, but any file works. **Initialize Dialog Project** seeds two starter PDFs (`introduction-to-if.pdf`, `play-if-card.pdf`) and wires them into `dialog.json`'s `feelies` array automatically. Right-click a file in the Explorer and choose **Add Feelie** to attach it directly (or run **Dialog IDE: Add Feelie...** from the Command Palette, which prompts you to pick a file instead), then give it a display name; **Dialog IDE: Remove Feelie...** takes one out again. Unlike the cover image, a configured feelie whose file has gone missing is an error at export time, not a silent omission - fix the path in `dialog.json` or remove the feelie.

## Command-Line Interface

`dgbuild` runs project checks headlessly - no VS Code, no extension host - for scripts and CI (e.g. gating a release on a GitHub Action). It ships as part of the `dialog-ide` npm package (there's an unrelated, older `dgbuild` package already on npm - not this one), so install it with `npm install -g dialog-ide`, or run it without installing via `npx -p dialog-ide dgbuild ...` (plain `npx dgbuild ...` will resolve to that other, unrelated package). Once installed, run it from your project root or pass `--project <dir>`:

- **`dgbuild test`** - runs the project's unit tests (`dgdebug --unit-test`) and exits non-zero on any failure, *or if `dialog.json` declares no `test` sources at all* (nothing to run is treated as a failure, not a silent pass). `--no-debug` excludes debug sources (included by default, matching **Dialog IDE: Run Tests**); extra arguments after the options are passed through to `dgdebug`.
- **`dgbuild run-skein [names...]`** - replays one or more saved skeins (default: `default`, matching `default.skein`) against a fresh `dgdebug` process each, exits non-zero if any knot's live response no longer matches its blessed response across any of them, and prints a `valid/new/error` count summary per skein plus a `total` line when running more than one, e.g. `default: 200/0/1 (valid/new/error)`. Errored knots are printed above the summary. Add `-v/--verbose` to see the underlying `dgdebug` process commands/lifecycle logging (suppressed by default - busy otherwise, especially with multiple skeins).
- **`dgbuild new-skein [name]`** / **`dgbuild open-skein [name]`** - create a new skein (default `default`), or open an existing one, and run its full interactive browser UI headlessly - the same Skein panel the extension shows, served on `http://localhost:<port>`. Prints the URL and opens your browser (`--no-open` to skip); the in-UI **Quit** button (or Ctrl+C) stops the server, prompting to save first if there are unsaved changes. `new-skein` takes `--seed <n>`; `open-skein` replays every branch on load to pick up source edits. Both take `--port <n>` (default: an OS-assigned free port), `--theme <light|dark>`, `-p/--project` and `-v/--verbose`. `dgdebug` only for now. Tracing opens in a second browser tab.
- **`dgbuild sources`** - prints the project's expanded source file list (`-d/--debug`, `-t/--test` to include those categories, `-T/--target <suffix>` to filter by target suffix, `-1/--single-line` for a colon-joined line instead of one path per line).
- **`dgbuild bundle [export-name]`** - builds the web page (`out/web/` plus a zip at `out/<name>-<release>.zip`) for one of `dialog.json`'s named export configurations, the headless equivalent of **Dialog IDE: Export Web Page...** - so a GitHub Action can publish a release. Pass the configuration name, or omit it when exactly one is defined. Needs `dialogc`, `dgdebug` and `aambundle`. Add `-v/--verbose` for the underlying `dgdebug` lifecycle logging.

A minimal release-gating step in a GitHub Action:

```yaml
- run: npx -p dialog-ide dgbuild test && npx -p dialog-ide dgbuild run-skein
```

To also publish a web page (e.g. to GitHub Pages) once the checks pass:

```yaml
- run: npx -p dialog-ide dgbuild bundle
- uses: actions/upload-pages-artifact@v3
  with:
    path: out/web
```

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

VS Code normally can't forward other keybindings through a webview at all (a platform limitation, not something extensions can fix generically), so Dialog IDE explicitly punches through ⌘⇧A / Ctrl+Shift+A to open the Command Palette while the Skein or Trace panel has focus - handy if you've remapped it there instead of the default ⌘⇧P / Ctrl+Shift+P.

## Known limitations

- `frotz`/`frotz-release` need `dfrotz` on `PATH` (or set as `binDir` in `dialog.json`) - unlike `dgdebug`/`dialogc`, it isn't bundled with the extension yet
- No "Reload from disk" action yet for picking up external changes to a `.skein` file
- Dynamic state and tracing require `dgdebug`, and are unavailable for a command that ends on a single-keystroke prompt (the debugger can't be interrupted mid-keystroke to ask for either)
- **Export Web Page...** needs `aambundle` (from [AAmachine](https://github.com/dialog-if/aamachine)) in addition to `dgdebug`/`dialogc` - see [Requirements](#requirements)
- An existing export configuration can't be edited in place yet - remove it and add it again with the new settings

## Future Improvements

This is an early release of the extension; we have many more features planned, including:

- Bundle `dfrotz` per platform, like `dgdebug`/`dialogc` already are
- Upload projects to the Interactive Fiction Archive
- Provide binaries for OS X on Intel hardware

Get involved at [Interactive Fiction Community Forum](https://intfiction.org/t/dialog-ide-0-0-1/81465/7) to provide feedback and ideas!

## License

[Apache License 2.0](LICENSE). The vendored `.dg` TextMate grammar and language configuration are separately MIT-licensed - see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
