/**
 * Light coverage of commander flag -> options-object wiring, exercised against the real
 * `sources` command (fast, no process spawn) rather than mocked command functions: register* and
 * its underlying pure function live in the same source file (src/cli/commands/*.ts), so a same-
 * module jest.mock can't intercept the internal call - registerXCommand's action handler calls
 * its co-located function directly, not through the mock's replaced export. `test`/`run-skein`'s
 * own flag wiring is equivalent in shape (same commander .option()/.argument() machinery) and is
 * exercised end-to-end by manual smoke testing (see CLAUDE.md) plus their own *.spec.ts files
 * asserting the pure functions' behavior given an options object.
 */

import { Command } from 'commander';
import * as path from 'path';
import { registerSourcesCommand } from './cli/commands/sources';

const FIXTURE_ROOT = path.join(__dirname, 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');

describe('sources subcommand wiring', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('maps --project/--debug/--single-line flags through to real behavior', async () => {
    const program = new Command();
    program.exitOverride();
    registerSourcesCommand(program);

    await program.parseAsync(['sources', '--project', FIXTURE_ROOT, '--debug', '--single-line'], {
      from: 'user'
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0];
    expect(line).toContain('stddebug.dg'); // only present when --debug was actually wired through
    expect((line as string).split(':').length).toBeGreaterThan(1); // only true when --single-line was wired through
  });

  it('maps -T/--target to the target-suffix filter', async () => {
    const program = new Command();
    program.exitOverride();
    registerSourcesCommand(program);
    const targetFilterRoot = path.join(__dirname, 'dialoged', 'skein', '__fixtures__', 'project', 'target-filter');

    await program.parseAsync(['sources', '-p', targetFilterRoot, '-T', 'dgdebug', '-1'], { from: 'user' });

    const [line] = logSpy.mock.calls[0];
    expect((line as string).split(':').map((p) => path.basename(p))).toEqual(['always.dg', 'sometimes.dgdebug.dg']);
  });
});
