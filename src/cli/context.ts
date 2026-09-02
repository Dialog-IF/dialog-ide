/**
 * Shared resolution helpers for the headless CLI (src/cli.ts) - the dgbuild-specific
 * equivalents of what extension.ts gets for free from vscode.ExtensionContext.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveBundledBinDir } from '../dialoged/skein';

/** A user-facing CLI failure - src/cli.ts prints just the message (no stack trace) and exits 1. */
export class CliError extends Error {}

/**
 * The CLI's own package root - the headless equivalent of vscode.ExtensionContext.extensionPath.
 * This file compiles to dist/cli/context.js, so its own __dirname is always
 * <packageRoot>/dist/cli - two levels up is always the package root containing bin/ and
 * resources/, whether invoked from within this repo (node dist/cli.js), an npm/npx install, or
 * a local `npm link`, since package.json's "files" allowlist ships them at those same fixed
 * relative locations either way.
 */
export function cliPackageRoot(): string {
  return path.join(__dirname, '..', '..');
}

export function cliVersion(): string {
  const pkgPath = path.join(cliPackageRoot(), 'package.json');
  return (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

export function resolveCliBundledBinDir(): string | undefined {
  return resolveBundledBinDir(cliPackageRoot());
}

export function resolveCliPatchSourcePath(): string {
  return path.join(cliPackageRoot(), 'resources', 'dfrotz-skein-patch.dg');
}

/**
 * This package's vendored web-bundle assets directory (resources/bundle/ - style.css, play.css,
 * default-cover.png, the "how to play IF" PDFs) - the headless equivalent of extension.ts passing
 * `path.join(context.extensionPath, 'resources', 'bundle')` into bundleWebExport. Shipped to npm
 * via package.json's `resources` files-allowlist glob, same as resolveCliPatchSourcePath's.
 */
export function resolveCliBundleAssetsDir(): string {
  return path.join(cliPackageRoot(), 'resources', 'bundle');
}

/**
 * This package's vendored web UI assets (media/style.css, media/js/*, media/icons/*) - the
 * headless equivalent of extension.ts passing `path.join(context.extensionPath, 'media')` into
 * SkeinService's ServiceConfig.mediaRoot. Shipped to npm via package.json's `media` files-allowlist
 * glob.
 */
export function resolveCliMediaRoot(): string {
  return path.join(cliPackageRoot(), 'media');
}

/**
 * This package's bundled Dialog TextMate grammar, used to syntax-colour the trace hover/source
 * snippets - the headless equivalent of extension.ts's resolveDialogGrammarPath (which resolves
 * the separately-installed language extension's copy instead). Shipped via the `syntaxes`
 * files-allowlist glob.
 */
export function resolveCliGrammarPath(): string {
  return path.join(cliPackageRoot(), 'syntaxes', 'dialog.tmLanguage.json');
}

/**
 * Temporarily silences console.log (but not console.error) for the duration of fn() - the
 * shared session/process/persistence layer (session.ts, process.ts, persistence.ts) logs its own
 * lifecycle events unconditionally via console.log ("Starting process: dgdebug --numbered...",
 * once per dgdebug launch - replayAll spawns one per leaf, so this can be many lines per skein).
 * That's fine for the VS Code extension host's own hidden console, but far too busy for a CI log
 * by default; callers opt back into seeing it via an explicit --verbose flag.
 */
export async function withQuietLogging<T>(quiet: boolean, fn: () => Promise<T>): Promise<T> {
  if (!quiet) {
    return fn();
  }
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

/**
 * Project root: cwd by default, or --project <dir> resolved against cwd. Deliberately doesn't
 * pre-validate dialog.json's existence here - readProject() already throws a clear
 * "<path>/dialog.json does not exist" error, so duplicating that check would just produce two
 * error messages for the same problem.
 */
export function resolveCliProjectRoot(cwd: string, projectOption?: string): string {
  return projectOption ? path.resolve(cwd, projectOption) : cwd;
}
