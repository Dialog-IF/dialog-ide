/**
 * `dgbuild run-skein [names...]` - replays one or more saved .skein files' knots against a fresh
 * dgdebug process and exits non-zero if any knot in any of them ends up 'error' (its live replay
 * no longer matches its blessed response). Headless equivalent of the interactive webview's
 * "Run All" action (SkeinService -> SkeinSession.replayAll), which today only runs inside the
 * extension host.
 */

import { Command } from 'commander';
import {
  DialogCompileError,
  PersistenceManager,
  SkeinSession,
  SkeinTree,
  readProject
} from '../../dialoged/skein';
import { DEFAULT_SESSION_ID, isValidSessionId, sessionConfigFromTree, toSessionId } from '../../session-runner';
import {
  CliError,
  resolveCliBundledBinDir,
  resolveCliPatchSourcePath,
  resolveCliProjectRoot,
  withQuietLogging
} from '../context';

export interface RunSkeinOptions {
  project?: string;
  verbose?: boolean;
  cwd?: string;
}

export interface SkeinStatusCounts {
  valid: number;
  new: number;
  error: number;
}

/** No process spawning, so this is directly unit-testable against a hand-built SkeinTree. */
export function countKnotStatuses(tree: SkeinTree): SkeinStatusCounts {
  return {
    valid: tree.knotIdsWithStatus('valid').length,
    new: tree.knotIdsWithStatus('new').length,
    error: tree.knotIdsWithStatus('error').length
  };
}

/** Pure: 0 if no knot ended up 'error' after a replay, 1 otherwise. */
export function deriveSkeinExitCode(tree: SkeinTree): number {
  return countKnotStatuses(tree).error > 0 ? 1 : 0;
}

function formatCounts(counts: SkeinStatusCounts): string {
  return `${counts.valid}/${counts.new}/${counts.error}`;
}

function reportErrorKnots(sessionId: string, tree: SkeinTree): void {
  for (const id of tree.knotIdsWithStatus('error')) {
    const knot = tree.getDerivedKnot(id);
    const label = knot?.label ? ` (${knot.label})` : '';
    console.error(`${sessionId} - knot #${id}${label}: "${knot?.command}" is invalid`);
  }
}

async function replayOneSkein(sessionId: string, projectRoot: string): Promise<SkeinStatusCounts> {
  const manager = new PersistenceManager(projectRoot);
  const tree = await manager.loadSession(sessionId);
  const config = sessionConfigFromTree(
    tree,
    projectRoot,
    resolveCliBundledBinDir(),
    resolveCliPatchSourcePath()
  );
  const session = SkeinSession.createLoaded(tree, config);

  try {
    await session.start();
    await session.replayAll();
  } catch (error) {
    if (error instanceof DialogCompileError) {
      const where = error.filePath ? ` (${error.filePath}${error.line ? `:${error.line}` : ''})` : '';
      throw new CliError(`${sessionId}: compile error${where}: ${error.message}`);
    }
    throw error;
  } finally {
    // Always terminate the child dgdebug process before this CLI process exits, or a live child
    // keeps the event loop alive even after the exit code below has been computed.
    await session.stop();
  }

  const finalTree = session.getTree();
  reportErrorKnots(sessionId, finalTree);
  return countKnotStatuses(finalTree);
}

export async function runSkeinCommand(namesOrFiles: string[], options: RunSkeinOptions): Promise<number> {
  const projectRoot = resolveCliProjectRoot(options.cwd ?? process.cwd(), options.project);
  readProject(projectRoot); // validates dialog.json exists, same as every other command

  const targets = namesOrFiles.length > 0 ? namesOrFiles : [DEFAULT_SESSION_ID];
  const sessionIds = targets.map((nameOrFile) => {
    const sessionId = toSessionId(nameOrFile);
    if (!isValidSessionId(sessionId)) {
      throw new CliError(`"${nameOrFile}" is not a valid skein name.`);
    }
    return sessionId;
  });

  const manager = new PersistenceManager(projectRoot);
  const missing: string[] = [];
  for (const sessionId of sessionIds) {
    if (!(await manager.sessionExists(sessionId))) {
      missing.push(`${sessionId}.skein`);
    }
  }
  if (missing.length > 0) {
    throw new CliError(`${missing.join(', ')} not found in ${projectRoot}.`);
  }

  const results = await withQuietLogging(!options.verbose, async () => {
    const collected: { sessionId: string; counts: SkeinStatusCounts }[] = [];
    for (const sessionId of sessionIds) {
      collected.push({ sessionId, counts: await replayOneSkein(sessionId, projectRoot) });
    }
    return collected;
  });

  for (const { sessionId, counts } of results) {
    console.log(`${sessionId}: ${formatCounts(counts)} (valid/new/error)`);
  }

  const total = results.reduce(
    (acc, { counts }) => ({
      valid: acc.valid + counts.valid,
      new: acc.new + counts.new,
      error: acc.error + counts.error
    }),
    { valid: 0, new: 0, error: 0 }
  );
  if (results.length > 1) {
    console.log(`total: ${formatCounts(total)} (valid/new/error)`);
  }

  return total.error > 0 ? 1 : 0;
}

export function registerRunSkeinCommand(program: Command): void {
  program
    .command('run-skein')
    .description('Replay one or more saved skeins and exit non-zero if any knot is invalid')
    .argument('[names...]', `skein names or filenames (default: "${DEFAULT_SESSION_ID}")`)
    .option('-p, --project <dir>', 'project directory (default: current directory)')
    .option('-v, --verbose', 'print the underlying dgdebug process commands/lifecycle logging')
    .action(async (names: string[], options: RunSkeinOptions) => {
      process.exitCode = await runSkeinCommand(names, options);
    });
}
