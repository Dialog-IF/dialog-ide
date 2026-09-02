/**
 * `dgbuild new-skein [name]` - create a new skein (default `default`) and run its full interactive
 * browser UI with no VS Code, until the in-UI Quit button or Ctrl+C. Headless counterpart of the
 * extension's "New Skein" command + Skein panel. Refuses to overwrite an existing `.skein`.
 */

import { Command } from 'commander';
import { PersistenceManager, readProject } from '../../dialoged/skein';
import { SessionRunnerError, parseSeed, randomSeed } from '../../session-runner';
import { CliError, resolveCliProjectRoot } from '../context';
import { parsePortOption, parseThemeOption, resolveSkeinSessionId, runInteractiveSkein } from './skein-server';

export interface NewSkeinOptions {
  project?: string;
  port?: string;
  seed?: string;
  theme?: string;
  open?: boolean;
  verbose?: boolean;
  cwd?: string;
}

/** `--seed` -> a non-negative integer, or a random one when omitted. Wraps parseSeed's
 *  SessionRunnerError as a CliError so cli.ts's top-level handler prints it without a stack. */
export function resolveSeedOption(value: string | undefined): number {
  if (value === undefined) {
    return randomSeed();
  }
  try {
    return parseSeed(value);
  } catch (error) {
    if (error instanceof SessionRunnerError) {
      throw new CliError(error.message);
    }
    throw error;
  }
}

export async function newSkeinCommand(name: string | undefined, options: NewSkeinOptions): Promise<number> {
  const projectRoot = resolveCliProjectRoot(options.cwd ?? process.cwd(), options.project);
  readProject(projectRoot); // validates dialog.json exists, same as every other command
  const sessionId = resolveSkeinSessionId(name);
  const seed = resolveSeedOption(options.seed);
  const theme = parseThemeOption(options.theme);
  const port = parsePortOption(options.port);

  if (await new PersistenceManager(projectRoot).sessionExists(sessionId)) {
    throw new CliError(`${sessionId}.skein already exists - use "dgbuild open-skein" to open it.`);
  }

  return runInteractiveSkein(
    { projectRoot, sessionId, mode: 'new', seed, theme, port, verbose: options.verbose, open: options.open },
    `Created ${sessionId}.skein (seed ${seed})`
  );
}

export function registerNewSkeinCommand(program: Command): void {
  program
    .command('new-skein')
    .description('Create a new skein and run its interactive browser UI until Ctrl+C')
    .argument('[name]', 'skein name (default: "default")')
    .option('-p, --project <dir>', 'project directory (default: current directory)')
    .option('--seed <n>', 'random seed (default: a random one)')
    .option('--port <n>', 'HTTP port (default: an OS-assigned free port)', '0')
    .option('--theme <name>', 'light | dark', 'light')
    .option('--no-open', 'do not open a browser automatically')
    .option('-v, --verbose', 'print the underlying dgdebug process lifecycle logging')
    .action(async (name: string | undefined, options: NewSkeinOptions) => {
      process.exitCode = await newSkeinCommand(name, options);
    });
}
