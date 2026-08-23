/**
 * `dgbuild test` - runs a project's unit tests headlessly and exits non-zero on any failure.
 *
 * Unlike session-runner.ts's testTerminalShellArgs (built for an interactive PTY terminal, where
 * --unit-test's bundled --quit would close the pane before failing output could be read), this
 * command is a real headless child process with no PTY to preserve, so it uses --unit-test
 * directly and simply forwards dgdebug's own exit code - confirmed against dialog/unit.dg: the
 * stdlib's test runner calls (quit 0) when every test passes, (quit 1) when any test fails, and
 * (quit 2) on a fatal VM error mid-test. This mirrors dialog-tool's own `test-project` command
 * (dialog_tool/commands.clj), which does the same "just forward the child's exit code".
 */

import { Command } from 'commander';
import { spawn } from 'child_process';
import { expandSources, readProject, resolveCommandPath } from '../../dialoged/skein';
import { isDgdebugAvailable } from '../../session-runner';
import { CliError, resolveCliBundledBinDir, resolveCliProjectRoot } from '../context';

export interface TestOptions {
  project?: string;
  debug?: boolean;
  cwd?: string;
}

export async function runTestsCommand(options: TestOptions, extraArgs: string[] = []): Promise<number> {
  const projectRoot = resolveCliProjectRoot(options.cwd ?? process.cwd(), options.project);
  const project = readProject(projectRoot);
  const bundledBinDir = resolveCliBundledBinDir();

  if (!(await isDgdebugAvailable(project.binDir, bundledBinDir))) {
    throw new CliError('dgdebug not found - install the Dialog toolchain, or set dialog.json\'s binDir.');
  }

  const debug = options.debug ?? true;
  const sourceFiles = expandSources(project, { debug, test: true, target: 'dgdebug' });
  const withoutTest = expandSources(project, { debug, test: false, target: 'dgdebug' });
  if (sourceFiles.length === withoutTest.length) {
    throw new CliError('No test sources declared in dialog.json\'s "test" category - nothing to run.');
  }

  const dgdebugPath = resolveCommandPath(project.binDir, 'dgdebug', bundledBinDir);
  const args = ['--unit-test', ...extraArgs, ...sourceFiles];

  return new Promise<number>((resolve, reject) => {
    const child = spawn(dgdebugPath, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description('Run a project\'s unit tests, exiting non-zero on any failure')
    .option('-p, --project <dir>', 'project directory (default: current directory)')
    .option('--no-debug', 'exclude the project\'s debug sources')
    .argument('[args...]', 'extra arguments passed through to dgdebug')
    .action(async (extraArgs: string[], options: TestOptions) => {
      process.exitCode = await runTestsCommand(options, extraArgs);
    });
}
