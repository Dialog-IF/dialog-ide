/**
 * `dgbuild open-skein [name]` - open an existing skein (default `default`) and run its full
 * interactive browser UI with no VS Code, until the in-UI Quit button or Ctrl+C. Headless
 * counterpart of the extension's "Run Skein" command + Skein panel; replays every branch on load
 * to pick up source edits, exactly as the extension does. Refuses a missing file or a
 * non-dgdebug skein.
 */

import { Command } from 'commander';
import { PersistenceManager, readProject } from '../../dialoged/skein';
import { CliError, resolveCliProjectRoot } from '../context';
import { parsePortOption, parseThemeOption, resolveSkeinSessionId, runInteractiveSkein } from './skein-server';

export interface OpenSkeinOptions {
  project?: string;
  port?: string;
  theme?: string;
  open?: boolean;
  verbose?: boolean;
  cwd?: string;
}

export async function openSkeinCommand(name: string | undefined, options: OpenSkeinOptions): Promise<number> {
  const projectRoot = resolveCliProjectRoot(options.cwd ?? process.cwd(), options.project);
  readProject(projectRoot); // validates dialog.json exists, same as every other command
  const sessionId = resolveSkeinSessionId(name);
  const theme = parseThemeOption(options.theme);
  const port = parsePortOption(options.port);

  if (!(await new PersistenceManager(projectRoot).sessionExists(sessionId))) {
    throw new CliError(`${sessionId}.skein not found in ${projectRoot}.`);
  }

  return runInteractiveSkein(
    { projectRoot, sessionId, mode: 'open', theme, port, verbose: options.verbose, open: options.open },
    `Opened ${sessionId}.skein`
  );
}

export function registerOpenSkeinCommand(program: Command): void {
  program
    .command('open-skein')
    .description('Open an existing skein and run its interactive browser UI until Ctrl+C')
    .argument('[name]', 'skein name (default: "default")')
    .option('-p, --project <dir>', 'project directory (default: current directory)')
    .option('--port <n>', 'HTTP port (default: an OS-assigned free port)', '0')
    .option('--theme <name>', 'light | dark', 'light')
    .option('--no-open', 'do not open a browser automatically')
    .option('-v, --verbose', 'print the underlying dgdebug process lifecycle logging')
    .action(async (name: string | undefined, options: OpenSkeinOptions) => {
      process.exitCode = await openSkeinCommand(name, options);
    });
}
