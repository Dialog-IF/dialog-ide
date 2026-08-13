# Changelog

## 0.0.2 - 12 Aug 2026

- Rewrote `README.md` for end users (Dialog authors), covering the Skein workflow, keyboard shortcuts, and project setup
- Moved developer-facing content (source layout, build/test/package workflow) into `technical-design.md`
- Nav graph connectors now use an orthogonal elbow (vertical, then a sharp turn to horizontal, then a slightly curved turn back to vertical) instead of a bezier curve
- Nav graph's expand/collapse control is now a larger boxed +/- icon instead of a small chevron, with an opaque interior so the connector line no longer bleeds through it

## 0.0.1 - 11 Aug 2026

Initial release.

- Skein engine for the `dgdebug` interpreter: process management, session orchestration, tag-line prompt detection
- Transcript and nav-graph webview UI, with full keyboard-first navigation
- Bless/undo/redo, Replay and Replay All, time travel, Insert Parent, Splice Out, knot labels and locking
- Dynamic state capture and diffing (`@dynamic`)
- Trace panel with click-through to source
- Full-text search over knot labels and responses
- `.skein` file persistence, compatible with dialog-tool's flat-file format
- `dialog.json` project support (source discovery/ordering)
- VS Code extension packaging (`.vsix`), icon, and Apache-2.0 license
