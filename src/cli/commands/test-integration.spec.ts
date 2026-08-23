/**
 * Real (non-mocked) integration test for `dgbuild test` - proves the "just forward dgdebug's own
 * exit code" design actually holds against the real binary, using dedicated pass/fail fixtures
 * (__fixtures__/project/unit-tests-pass, unit-tests-fail). Kept in its own file, unmocked, rather
 * than sharing test.spec.ts's mocked child_process - matching dgdebug-integration.spec.ts's own
 * convention elsewhere in this codebase. Skips itself (rather than failing) when dgdebug isn't on
 * PATH, so the rest of the suite stays portable to machines/CI without the Dialog toolchain.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';
import { runTestsCommand } from './test';

function isDgdebugAvailable(): boolean {
  try {
    execFileSync('dgdebug', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfDgdebug = isDgdebugAvailable() ? describe : describe.skip;

describeIfDgdebug('runTestsCommand (real dgdebug)', () => {
  jest.setTimeout(15000);

  const FIXTURES_ROOT = path.join(__dirname, '..', '..', 'dialoged', 'skein', '__fixtures__', 'project');

  it('exits 0 when every unit test passes', async () => {
    const passRoot = path.join(FIXTURES_ROOT, 'unit-tests-pass');
    expect(await runTestsCommand({ project: passRoot, debug: false }, [])).toBe(0);
  });

  it('exits non-zero when a unit test fails', async () => {
    const failRoot = path.join(FIXTURES_ROOT, 'unit-tests-fail');
    expect(await runTestsCommand({ project: failRoot, debug: false }, [])).toBe(1);
  });

  it('rejects rather than silently succeeding when a project declares no test sources at all', async () => {
    const noTestsRoot = path.join(FIXTURES_ROOT, 'dgsample');
    await expect(runTestsCommand({ project: noTestsRoot }, [])).rejects.toThrow('No test sources declared');
  });
});
