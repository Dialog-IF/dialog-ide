#!/usr/bin/env node
/**
 * dgbuild - headless CLI for Dialog IDE project operations (testing, skein validation, source
 * listing) for use in scripts and CI, without the VS Code extension host. Named to match the
 * existing dgdebug/dialogc/aambundle toolchain family rather than the dialog-ide extension
 * itself, since it's meant to run with no IDE context at all.
 */

import { Command, CommanderError } from 'commander';
import { DialogCompileError } from './dialoged/skein';
import { CliError, cliVersion } from './cli/context';
import { registerBundleCommand } from './cli/commands/bundle';
import { registerRunSkeinCommand } from './cli/commands/run-skein';
import { registerSourcesCommand } from './cli/commands/sources';
import { registerTestCommand } from './cli/commands/test';

const program = new Command();
program
  .name('dgbuild')
  .description('Headless CLI for Dialog IDE project operations (scripting/CI use)')
  .version(cliVersion());

registerTestCommand(program);
registerRunSkeinCommand(program);
registerSourcesCommand(program);
registerBundleCommand(program);

// Prevent commander's own process.exit() calls so the catch below is the single place that
// decides the final exit code.
program.exitOverride();

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CommanderError) {
    // commander has already printed its own usage/help/version output - just adopt its exit code.
    process.exitCode = error.exitCode;
    return;
  }
  if (error instanceof CliError || error instanceof DialogCompileError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = process.exitCode ?? 1;
});
