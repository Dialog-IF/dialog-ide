/**
 * `dgbuild sources` - prints the expanded list of a project's source files. Direct port of
 * dialog-tool's own `sources` command (dialog_tool/commands.clj), including its "one path per
 * line for humans, colon-joined single line for scripting" duality - minus its colored/aligned
 * output, which this codebase has no equivalent helper for yet.
 */

import { Command } from 'commander';
import { expandSources, readProject } from '../../dialoged/skein';
import { resolveCliProjectRoot } from '../context';

export interface SourcesOptions {
  project?: string;
  debug?: boolean;
  test?: boolean;
  target?: string;
  singleLine?: boolean;
  cwd?: string;
}

/**
 * Pure aside from console output: no process spawning, so this is directly unit-testable against
 * a fixture project. Always returns 0 on success (even an empty result, matching dialog-tool's
 * own behavior - a warning, not a failure); a missing dialog.json throws from readProject and is
 * handled by src/cli.ts's top-level error handler.
 */
export function listSourcesCommand(options: SourcesOptions): number {
  const projectRoot = resolveCliProjectRoot(options.cwd ?? process.cwd(), options.project);
  const project = readProject(projectRoot);
  const paths = expandSources(project, {
    debug: options.debug,
    test: options.test,
    target: options.target
  });

  if (paths.length === 0) {
    console.error('No matching source files');
    return 0;
  }

  if (options.singleLine) {
    console.log(paths.join(':'));
  } else {
    for (const p of paths) {
      console.log(p);
    }
  }
  return 0;
}

export function registerSourcesCommand(program: Command): void {
  program
    .command('sources')
    .description('Print the expanded list of a project\'s source files')
    .option('-p, --project <dir>', 'project directory (default: current directory)')
    .option('-d, --debug', 'include the project\'s debug sources')
    .option('-t, --test', 'include the project\'s test sources')
    .option('-T, --target <suffix>', 'only include sources matching this target suffix (e.g. "zblorb")')
    .option('-1, --single-line', 'print all paths colon-joined on a single line, for scripting')
    .action((options: SourcesOptions) => {
      process.exitCode = listSourcesCommand(options);
    });
}
