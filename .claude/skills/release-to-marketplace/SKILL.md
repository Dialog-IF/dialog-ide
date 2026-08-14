---
name: release-to-marketplace
description: Use when the user explicitly asks to release, cut a release, or publish a new version of Dialog IDE to the VS Code Marketplace (e.g. "release", "cut a release", "publish 0.0.2", "ship this version"). Not triggered by ordinary commits or PR merges - only an explicit release request.
---

# Release Dialog IDE

Walks through releasing the current `package.json` version of Dialog IDE (publisher `hlship`,
extension id `hlship.dialog-ide`) to the VS Code Marketplace, tagging it in git, and opening the
next development cycle. Run interactively, one step at a time - stop at every checkpoint marked
**CONFIRM** and wait for explicit go-ahead before running it, per this repo's "don't commit or
push without confirming" rule. Never batch past a CONFIRM checkpoint even if earlier ones were
approved.

## Facts specific to this project (don't re-derive these)

- The extension is already live on the Marketplace (`hlship.dialog-ide`) - publishing credentials/
  (`vsce login hlship`, PAT stored in the OS keychain) are already configured on this machine from
  a prior publish. If `vsce publish` fails with an auth error, tell the user to run
  `npx vsce login hlship` and retry - don't try to source or create a PAT yourself.
- **No git tags or GitHub Releases exist yet in this repo** - this skill establishes the
  convention (`vX.Y.Z`, matching npm/vsce's own default tag format) rather than following one.
- This project bumps `package.json`'s version and opens a new `CHANGELOG.md` heading *proactively*
  while work lands on `main`, ahead of actually publishing - e.g. `package.json` may already read
  `0.0.2` while the Marketplace still has `0.0.1` live. That means **the version to release is
  whatever's currently in `package.json`** - never run `vsce publish patch`/`minor`/`major` (or
  give it a bare version) here, since vsce would bump the version *before* publishing and skip
  past the one that's actually ready.
- `.github/workflows/test.yml` runs `npm run build` + `npm test` on every push to `main` - this
  skill re-verifies locally too (main may have moved, or the local toolchain may differ) but isn't
  reinventing CI from scratch.
- `*.vsix` is gitignored - safe to build one in the repo root and delete it afterward.
- `package.json`'s `files` allowlist is an explicit, manually-maintained list (see CLAUDE.md's
  Packaging section) - a new static asset or dependency not added there silently won't ship. Worth
  a `vsce ls` sanity check before publishing, especially if this release touched that list.
- This extension bundles the `dgdebug`/`dialogc` binaries for exactly three targets -
  `win32-x64`, `darwin-arm64`, `linux-x64` - staged into the gitignored `bin/<target>/` by
  `scripts/fetch-dialog-binaries.js` from the release pinned in
  `scripts/dialog-toolchain-version.json`. Every other target, and the universal (no-`--target`)
  package, ship with no bundled binary and keep relying on `PATH`/`dialog.json`'s `binDir` as
  before - this means publishing is now **4 passes** (3 targeted + 1 universal), not 1, and each
  targeted pass must re-run the fetch script for its own target immediately beforehand so the
  `.vsix` only ever contains that platform's binaries (`vsce`'s `--target` flag does not filter
  which files get packaged - it only tags the output's platform metadata).

## Steps

### 1. Preconditions

- `git branch --show-current` - must be `main`. If not, stop and ask whether to switch, rather
  than releasing from a feature branch.
- `git fetch origin && git status` - working tree must be clean and local `main` must match
  `origin/main` exactly (not ahead, not behind). If behind, pull. If ahead with unpushed commits,
  stop - those commits aren't on GitHub yet, so CI hasn't seen them.
- Confirm the latest commit on `main` has a passing CI run (`gh run list --branch main --limit 1`
  or equivalent). If it's failing or still running, stop and surface that rather than releasing
  through it.

### 2. Determine the release version

- Read the `version` field from `package.json` - this is the version being released.
- Read `CHANGELOG.md`'s top-most `##` heading. Its version must match `package.json`'s. If it
  doesn't, stop and ask the user to reconcile before continuing (don't guess which one is right).
- Check whether that heading's date is actually today. This project dates a heading as bullets
  land during development, so it may already be stale by the time of the real release - update it
  to today's date if so.

**CONFIRM**: Show the user the full version number and the complete bullet list under that
heading. Get explicit go/no-go before continuing - this is the content that becomes the release
notes.

### 3. Local verification

- `npm test` - must pass in full (not just the subset that ran last in this session).
- `npm run build` - must succeed cleanly.
- `npx vsce ls` - eyeball the file list, especially if this release added any new static asset,
  dependency, or touched the `files` allowlist. This is the point to catch a missing entry before
  it ships as a `Cannot find module` crash on activation. `vsce ls` has no `--target` flag - the
  `files` allowlist is the same regardless of target, so a plain `vsce ls` is enough to confirm
  `bin/**/*` is present once something is staged there (`node scripts/fetch-dialog-binaries.js
  --target <any-target>` first if `bin/` is currently empty).

If anything here fails, stop and fix it (or hand it back to the user) rather than proceeding past
a red step.

### 4. Finalize the changelog

Only if step 2 required a date fix: commit it.

**CONFIRM** before running `git commit`. Suggested message: `chore: release vX.Y.Z`.

### 5. Tag

```
git tag -a vX.Y.Z -m "vX.Y.Z"
```

**CONFIRM** before pushing - a pushed tag is effectively public and awkward to walk back:

```
git push origin main --follow-tags
```

(This also pushes the changelog-date commit from step 4, if any.)

### 6. Publish to the Marketplace

**CONFIRM once** before running the whole sequence below - publishing is a one-way door: a
version number, once published, can't be republished, only unpublished as a separate, heavier
action. Don't ask for a separate confirmation per target; this is one logical step.

```
for target in win32-x64 darwin-arm64 linux-x64; do
  node scripts/fetch-dialog-binaries.js --target "$target"
  npx vsce publish --target "$target"
done
node scripts/fetch-dialog-binaries.js --target none
npx vsce publish --allow-unused-files-pattern
```

No version argument on any of the four `vsce publish` calls - this ships whatever's currently in
`package.json` as-is (see the facts above for why). The final call needs
`--allow-unused-files-pattern` because `bin/` is empty for the universal package, which would
otherwise make `vsce` error on the `bin/**/*` entry in `files` matching nothing.

### 7. GitHub Release (recommended, but skippable if the user doesn't want it)

```
for target in win32-x64 darwin-arm64 linux-x64; do
  node scripts/fetch-dialog-binaries.js --target "$target"
  npx vsce package --target "$target"
done
node scripts/fetch-dialog-binaries.js --target none
npx vsce package --allow-unused-files-pattern

gh release create vX.Y.Z dialog-ide-X.Y.Z-win32-x64.vsix dialog-ide-X.Y.Z-darwin-arm64.vsix \
  dialog-ide-X.Y.Z-linux-x64.vsix dialog-ide-X.Y.Z.vsix \
  --title "vX.Y.Z" --notes "<the changelog bullets from step 2>"
rm dialog-ide-X.Y.Z*.vsix
```

Gives a changelog-anchored release page and non-Marketplace `.vsix` download options (one per
bundled target, plus the universal package). Clean up the local `.vsix` files afterward - they're
gitignored but there's no reason to leave them lying around.

**First time only** (this project has never shipped a `.vsix` with native executables before):
install one of the freshly built targeted `.vsix` files in a clean VS Code profile with no Dialog
toolchain on `PATH` and no `binDir` set, and run "New Skein..." once to confirm it actually
launches using the bundled binary. Also budget extra time for this first bundled-binary publish -
the Marketplace's malware/antivirus scanning may take longer over a package containing native
executables than this project's past pure-JS/TS releases.

### 8. Open the next development cycle

- `npm version --no-git-tag-version <patch|minor|major>` to bump `package.json` toward the next
  version. Ask the user which bump size if it isn't obvious from what's already planned/in
  flight. The `--no-git-tag-version` flag matters - this step must NOT create another tag or
  commit on its own; step 9 does that deliberately.
- Add a new heading to the top of `CHANGELOG.md`: `## X.Y.Z - Unreleased` (no bullets yet - they
  accumulate as work lands, matching this project's existing convention. No date yet either; that
  gets filled in at the next release, per step 2).

**CONFIRM** before committing (`chore: begin vX.Y.Z development`) and again before pushing.
