---
name: release-to-marketplace
description: Use when the user explicitly asks to release, cut a release, or publish a new version of Dialog IDE to the VS Code Marketplace (e.g. "release", "cut a release", "publish 0.0.2", "ship this version"). Not triggered by ordinary commits or PR merges - only an explicit release request.
---

# Release Dialog IDE

Confirms the version and release notes for the current `package.json` version of Dialog IDE
(publisher `hlship`, extension id `hlship.dialog-ide`), tags it, and pushes - that tag push is
what actually ships it: `.github/workflows/release.yml` takes over from there (build/test gate,
publish to the Marketplace for all four targets, create the GitHub Release). This skill's own job
ends at "push the tag"; its last step (opening the next development cycle) runs after, once the
tag is safely pushed. Run interactively, one step at a time - stop at every checkpoint marked
**CONFIRM** and wait for explicit go-ahead before running it, per this repo's "don't commit or
push without confirming" rule. Never batch past a CONFIRM checkpoint even if earlier ones were
approved.

## Division of labor

- **This skill (local, interactive)**: confirm the version and release notes, finalize the
  changelog date, tag, push. Nothing here talks to the Marketplace or GitHub Releases directly.
- **`.github/workflows/release.yml` (triggered by the tag push)**: `npm run build` + `npm test` as
  a last gate, then for each of `win32-x64`/`darwin-arm64`/`linux-x64`/universal: fetch that
  target's bundled binaries, `vsce publish`, `vsce package`. Finally reads the annotated tag's own
  message back out as release notes and creates the GitHub Release with all four `.vsix`s
  attached. Watch it at `gh run list --workflow=release.yml` or the Actions tab.

Because pushing the tag is now irreversible (it immediately publishes), do the local verification
in step 3 for real, not as a formality - there's no later human checkpoint before the Marketplace
publish the way there used to be.

## Facts specific to this project (don't re-derive these)

- **One-time setup, if not already done**: the workflow needs a `VSCE_PAT` repository secret (a
  Marketplace personal access token for publisher `hlship`) - `Settings > Secrets and variables >
  Actions` on GitHub, or `gh secret set VSCE_PAT`. If a release run fails with a publish auth
  error, that's almost certainly a missing/expired secret - tell the user to refresh it; don't try
  to source or create a PAT yourself.
- This project bumps `package.json`'s version and opens a new `CHANGELOG.md` heading *proactively*
  while work lands on `main`, ahead of actually releasing - e.g. `package.json` may already read
  `0.0.2` while the Marketplace still has `0.0.1` live. That means **the version to release is
  whatever's currently in `package.json`** - never bump the version as part of releasing (that
  happens only in step 6, for the *next* cycle).
- `*.vsix` is gitignored - the release workflow builds its own on the runner; nothing to clean up
  locally.
- `package.json`'s `files` allowlist is an explicit, manually-maintained list (see CLAUDE.md's
  Packaging section) - a new static asset or dependency not added there silently won't ship. Worth
  a local `npx vsce ls` sanity check in step 3 if this release touched that list, since a bad
  entry would otherwise only surface as a failed (or worse, wrongly-succeeded) Marketplace publish
  in CI.
- This extension bundles the `dgdebug`/`dialogc` binaries for exactly three targets -
  `win32-x64`, `darwin-arm64`, `linux-x64` - staged into the gitignored `bin/<target>/` by
  `scripts/fetch-dialog-binaries.js` from the release pinned in
  `scripts/dialog-toolchain-version.json`. Every other target, and the universal (no-`--target`)
  package, ship with no bundled binary and keep relying on `PATH`/`dialog.json`'s `binDir` as
  before - the release workflow already accounts for this (4 publish/package passes), nothing to
  do here.

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

### 2. Determine the release version and notes

- Read the `version` field from `package.json` - this is the version being released.
- Read `CHANGELOG.md`'s top-most `##` heading. Its version must match `package.json`'s. If it
  doesn't, stop and ask the user to reconcile before continuing (don't guess which one is right).
- Check whether that heading's date is actually today. This project dates a heading as bullets
  land during development, so it may already be stale by the time of the real release - update it
  to today's date if so.
- Draft the release notes, starting from that heading's bullet list. If anything worth telling
  users isn't well captured by the changelog as-is - a first-time-only heads-up (e.g. "this
  release bundles native binaries for the first time"), a migration note, a known issue - add it.
  This is the one place to supply that; the release workflow only ever sees what ends up in the
  tag message (step 5), not the changelog itself.

**CONFIRM**: Show the user the full version number and the complete release notes (changelog
bullets plus anything added). Get explicit go/no-go before continuing - this becomes both the tag
message and the GitHub Release body, verbatim.

### 3. Local verification

- `npm test` - must pass in full (not just the subset that ran last in this session).
- `npm run build` - must succeed cleanly.
- `npx vsce ls` - eyeball the file list if this release added any new static asset, dependency, or
  touched the `files` allowlist. `vsce ls` has no `--target` flag - the allowlist is the same
  regardless of target, so a plain `vsce ls` is enough (`node scripts/fetch-dialog-binaries.js
  --target <any-target>` first if `bin/` is currently empty, so `bin/**/*` has something to list).

If anything here fails, stop and fix it (or hand it back to the user) rather than proceeding past
a red step - remember, there's no human checkpoint after step 5 anymore.

### 4. Finalize the changelog

Only if step 2 required a date fix: commit it.

**CONFIRM** before running `git commit`. Suggested message: `chore: release vX.Y.Z`.

### 5. Tag and push

Write the confirmed release notes from step 2 to a scratch file (e.g. via the Write tool), then:

```
git tag -a vX.Y.Z -F <path-to-that-file>
```

`release.yml` reads the tag's own annotation back out via `git tag -l --format='%(contents)'`, so
whatever's in the tag message becomes the GitHub Release body verbatim - a plain `-m "vX.Y.Z"`
here would ship a release with no real notes.

**CONFIRM** before pushing - this is the point of no return: pushing the tag triggers
`release.yml`, which publishes to the Marketplace immediately, with no further pause:

```
git push origin main --follow-tags
```

(This also pushes the changelog-date commit from step 4, if any.)

After pushing, tell the user the release workflow has started and where to watch it (`gh run list
--workflow=release.yml --limit 1`, or the repo's Actions tab) - don't wait/poll for it yourself.

### 6. Open the next development cycle

This step is independent of whether the release workflow has finished yet - it only touches
`main`, not anything the workflow publishes.

- `npm version --no-git-tag-version <patch|minor|major>` to bump `package.json` toward the next
  version. Ask the user which bump size if it isn't obvious from what's already planned/in
  flight. The `--no-git-tag-version` flag matters - this step must NOT create another tag on its
  own; only step 5 does that.
- Add a new heading to the top of `CHANGELOG.md`: `## X.Y.Z - Unreleased` (no bullets yet - they
  accumulate as work lands, matching this project's existing convention. No date yet either; that
  gets filled in at the next release, per step 2).

**CONFIRM** before committing (`chore: begin vX.Y.Z development`) and again before pushing.
