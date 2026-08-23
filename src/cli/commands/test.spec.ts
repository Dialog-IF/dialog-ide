import { EventEmitter } from 'events';

const mockSpawn = jest.fn();
const mockExecFile = jest.fn((_cmd: string, _args: string[], callback: (error: Error | null) => void) => {
  callback(null); // simulates a successful `dgdebug --version` preflight check
});
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: (...args: unknown[]) => mockExecFile(...(args as [string, string[], (error: Error | null) => void]))
}));

import * as path from 'path';
import { runTestsCommand } from './test';

function createFakeChildProcess() {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null };
  child.exitCode = null;
  return child;
}

const FIXTURES_ROOT = path.join(__dirname, '..', '..', 'dialoged', 'skein', '__fixtures__', 'project');
// Has a declared "test" sources category (pass.dg + unit.dg) - unlike dgsample, which has none
// and is used below specifically to exercise the "no tests declared" rejection path.
const WITH_TESTS_ROOT = path.join(FIXTURES_ROOT, 'unit-tests-pass');
const NO_TESTS_ROOT = path.join(FIXTURES_ROOT, 'dgsample');

/**
 * runTestsCommand awaits isDgdebugAvailable (itself an await over the mocked, promisified
 * execFile) before ever calling spawn - two microtask hops stand between calling
 * runTestsCommand() and spawn()/its 'exit'-listener attachment actually happening. Emitting
 * 'exit' on fakeChild before that listener is attached is a no-op the promise never sees, so
 * every test below must flush past both hops (a macrotask boundary is enough) before emitting.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('runTestsCommand', () => {
  let fakeChild: ReturnType<typeof createFakeChildProcess>;

  beforeEach(() => {
    mockSpawn.mockReset();
    fakeChild = createFakeChildProcess();
    mockSpawn.mockReturnValue(fakeChild);
  });

  it('spawns dgdebug with --unit-test, extra args, then source files, inheriting stdio', async () => {
    const promise = runTestsCommand({ project: WITH_TESTS_ROOT, debug: false }, ['--seed', '1']);
    await flushMicrotasks();
    fakeChild.emit('exit', 0, null);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'dgdebug',
      [
        '--unit-test',
        '--seed', '1',
        path.join(WITH_TESTS_ROOT, 'pass.dg'),
        path.join(WITH_TESTS_ROOT, 'unit.dg'),
        path.join(WITH_TESTS_ROOT, 'lib', 'stdlib.dg')
      ],
      { stdio: 'inherit' }
    );
  });

  it.each([0, 1, 2])('forwards dgdebug\'s own exit code (%i) unchanged', async (code) => {
    const promise = runTestsCommand({ project: WITH_TESTS_ROOT }, []);
    await flushMicrotasks();
    fakeChild.emit('exit', code, null);

    expect(await promise).toBe(code);
  });

  it('treats a signal-terminated child as a failure (exit code 1)', async () => {
    const promise = runTestsCommand({ project: WITH_TESTS_ROOT }, []);
    await flushMicrotasks();
    fakeChild.emit('exit', null, 'SIGTERM');

    expect(await promise).toBe(1);
  });

  it('rejects when the child process fails to spawn (e.g. dgdebug missing)', async () => {
    const promise = runTestsCommand({ project: WITH_TESTS_ROOT }, []);
    await flushMicrotasks();
    const spawnError = new Error('spawn dgdebug ENOENT');
    fakeChild.emit('error', spawnError);

    await expect(promise).rejects.toThrow('spawn dgdebug ENOENT');
  });

  it('throws a CliError instead of spawning when dgdebug is not available', async () => {
    mockExecFile.mockImplementationOnce((_cmd, _args, callback) => callback(new Error('ENOENT')));

    await expect(runTestsCommand({ project: WITH_TESTS_ROOT }, [])).rejects.toThrow('dgdebug not found');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws a CliError instead of spawning when no test sources are declared', async () => {
    await expect(runTestsCommand({ project: NO_TESTS_ROOT }, [])).rejects.toThrow('No test sources declared');
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
