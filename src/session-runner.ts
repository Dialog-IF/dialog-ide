/**
 * Pure logic backing the VS Code run-configuration commands (extension.ts) - deliberately has
 * no dependency on the `vscode` module, so it's unit-testable the same way project.ts/
 * persistence.ts are: plain functions over plain values, no mocking needed.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  EngineType,
  PersistenceManager,
  resolveCommandPath,
  SessionConfig,
  SkeinTree
} from './dialoged/skein';

export class SessionRunnerError extends Error {}

export const DEFAULT_SESSION_ID = 'default';

export interface EngineChoice {
  engine: EngineType;
  label: string;
  supported: boolean;
}

// frotz/frotz-release aren't offered as working choices yet - no dialogc pre-flight compile
// step exists (see session.ts), and dialog-tool's own CLI docs say frotz "has output
// formatting issues and is not yet ready for use" regardless.
export const ENGINE_CHOICES: readonly EngineChoice[] = [
  { engine: 'dgdebug', label: 'dgdebug', supported: true },
  { engine: 'frotz', label: 'frotz', supported: false },
  { engine: 'frotz-release', label: 'frotz-release', supported: false }
];

/**
 * The Dialog project root is assumed to be the open VS Code workspace folder.
 */
export function resolveProjectRoot(workspaceFolderPath: string | undefined): string {
  if (!workspaceFolderPath) {
    throw new SessionRunnerError('Open a folder containing a Dialog project (dialog.json) first.');
  }
  return workspaceFolderPath;
}

/**
 * Normalizes a user-typed filename ("default.skein" or "default") to a bare session id, as
 * used by PersistenceManager.
 */
export function toSessionId(filenameOrId: string): string {
  const trimmed = filenameOrId.trim();
  return trimmed.endsWith('.skein') ? trimmed.slice(0, -'.skein'.length) : trimmed;
}

/**
 * A session id must be a plain name, not a path - guards against directory traversal via a
 * typed filename.
 */
export function isValidSessionId(id: string): boolean {
  return id.length > 0 && !/[\\/]/.test(id) && id !== '.' && id !== '..';
}

/**
 * A loaded tree already carries its own engine/seed (fixed at creation) - this just adds the
 * project root to make a full SessionConfig for SkeinSession.createLoaded.
 */
export function sessionConfigFromTree(
  tree: SkeinTree,
  projectRoot: string,
  bundledBinDir?: string
): SessionConfig {
  return { engine: tree.getEngine(), seed: tree.getSeed(), projectRoot, bundledBinDir };
}

export async function listSkeinFiles(projectRoot: string): Promise<string[]> {
  return new PersistenceManager(projectRoot).listSessions();
}

/**
 * Matches dialog-tool's own fallback (rand-int 100000) in service.clj, for a seed left blank.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 100_000);
}

export function parseSeed(input: string): number {
  const trimmed = input.trim();
  const value = Number(trimmed);
  if (trimmed === '' || !Number.isInteger(value) || value < 0) {
    throw new SessionRunnerError(`"${input}" is not a valid seed - enter a non-negative whole number.`);
  }
  return value;
}

const execFileAsync = promisify(execFile);

/**
 * A missing dgdebug binary makes SkeinProcess/SkeinSession fail with a generic "Process closed
 * before a response was received" - this preflight check gives a clear, actionable message
 * instead, checked before session.start() is attempted.
 */
export async function isDgdebugAvailable(binDir?: string, bundledBinDir?: string): Promise<boolean> {
  try {
    await execFileAsync(resolveCommandPath(binDir, 'dgdebug', bundledBinDir), ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Same preflight as isDgdebugAvailable, for the dialogc compiler ahead of an export. */
export async function isDialogcAvailable(binDir?: string, bundledBinDir?: string): Promise<boolean> {
  try {
    await execFileAsync(resolveCommandPath(binDir, 'dialogc', bundledBinDir), ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Same preflight as isDialogcAvailable, for aambundle ahead of "Export Web Page...". */
export async function isAambundleAvailable(binDir?: string, bundledBinDir?: string): Promise<boolean> {
  try {
    await execFileAsync(resolveCommandPath(binDir, 'aambundle', bundledBinDir), ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Args for launching dgdebug as a genuinely interactive terminal session - matching
 * dialog-tool's own `dgt debug` command exactly: just --quit (exit the debugger when the
 * program terminates) plus the expanded source files, no --tag-lines/--unit-test/--seed/
 * --width. This is deliberately NOT the SkeinProcess/tag-line-parsed path - it's a raw,
 * unmanaged dgdebug session for free exploration, with VS Code's terminal owning a real PTY
 * (so dgdebug gets its own natural interactive behavior, including terminal-width detection),
 * not tied to any tracked skein session or tree.
 */
export function debugTerminalShellArgs(sourceFiles: string[]): string[] {
  return ['--quit', ...sourceFiles];
}

/**
 * Args for launching dgdebug in a terminal to run the project's unit tests - --no-header (skip
 * the version banner) plus the expanded source files, this time with the `test` category included
 * (unlike debugTerminalShellArgs above). Deliberately --no-header alone, NOT --unit-test:
 * --unit-test is dgdebug's own shorthand for "--quit --height=-1 --no-header" (confirmed via
 * `dgdebug --help`), and --quit is exactly the problem here - since this isn't a real shell (the
 * terminal's shellPath is dgdebug itself), the PTY closes the instant dgdebug exits, so with
 * --quit the pass/fail output flashes and disappears before it can be read, and VS Code reports a
 * misleading "process failed to launch" for any nonzero exit (i.e. any failing test). Without
 * --quit, dgdebug instead drops into its own "suspended>" debug prompt once the tests (run via
 * the `test` category's own lib/unit.dg overriding (program entry point) - see
 * dialog-project-init.ts's scaffolded dialog.json) finish - confirmed against a real run: the
 * terminal stays open with the full "Attempting N tests.../Testing #foo: Passed!/..." output
 * intact, and the user exits it themselves (@quit or Ctrl+D) once they've read the results.
 */
export function testTerminalShellArgs(sourceFiles: string[]): string[] {
  return ['--no-header', ...sourceFiles];
}
