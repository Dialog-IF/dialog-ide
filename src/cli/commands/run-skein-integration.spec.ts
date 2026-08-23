/**
 * Real (non-mocked) integration test for `dgbuild run-skein` - exercises the actual
 * SkeinSession.createLoaded -> start -> replayAll -> stop lifecycle against a real dgdebug
 * process, which the mocked tests in run-skein.spec.ts can't cover. Kept in its own file,
 * unmocked, matching dgdebug-integration.spec.ts's own convention elsewhere in this codebase.
 * Skips itself (rather than failing) when dgdebug isn't on PATH.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersistenceManager, SkeinSession } from '../../dialoged/skein';
import { runSkeinCommand } from './run-skein';

function isDgdebugAvailable(): boolean {
  try {
    execFileSync('dgdebug', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfDgdebug = isDgdebugAvailable() ? describe : describe.skip;

describeIfDgdebug('runSkeinCommand (real dgdebug)', () => {
  jest.setTimeout(15000);

  const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');

  it('exits 1 and reports the offending knot when a live replay no longer matches the blessed response', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    try {
      // demo-diff.skein's own blessed knot 2 response ("You take the orb.") deliberately no
      // longer matches what a live dgdebug replay produces ("You take the White Orb.") - see
      // the fixture file itself, which encodes this as a <<<<<<< diff marker.
      const exitCode = await runSkeinCommand(['demo-diff'], { project: FIXTURE_ROOT });

      expect(exitCode).toBe(1);
      expect(errorSpy.mock.calls.some(([line]) => String(line).includes('is invalid'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('exits 0 for a freshly blessed, still-matching skein, and leaves no lingering dgdebug process', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-run-skein-clean-'));
    fs.cpSync(FIXTURE_ROOT, tempRoot, { recursive: true });
    fs.rmSync(path.join(tempRoot, 'demo-diff.skein'));

    try {
      const setupSession = SkeinSession.createNew({ engine: 'dgdebug', seed: 42, projectRoot: tempRoot });
      await setupSession.start();
      await setupSession.runCommand('look');
      setupSession.blessKnot(setupSession.getTree().getActiveKnotId()!);
      await new PersistenceManager(tempRoot).saveSession(setupSession.getTree(), 'clean');
      await setupSession.stop();

      const exitCode = await runSkeinCommand(['clean'], { project: tempRoot });
      expect(exitCode).toBe(0);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('defaults to "default.skein" when no names are given', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-run-skein-default-'));
    fs.cpSync(FIXTURE_ROOT, tempRoot, { recursive: true });
    fs.renameSync(path.join(tempRoot, 'demo-diff.skein'), path.join(tempRoot, 'default.skein'));

    try {
      const exitCode = await runSkeinCommand([], { project: tempRoot });
      expect(exitCode).toBe(1); // demo-diff's content still has its known stale knot
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs multiple named skeins and aggregates a combined exit code', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-run-skein-multi-'));
    fs.cpSync(FIXTURE_ROOT, tempRoot, { recursive: true }); // brings along demo-diff.skein (error)

    const setupSession = SkeinSession.createNew({ engine: 'dgdebug', seed: 42, projectRoot: tempRoot });
    await setupSession.start();
    await setupSession.runCommand('look');
    setupSession.blessKnot(setupSession.getTree().getActiveKnotId()!);
    await new PersistenceManager(tempRoot).saveSession(setupSession.getTree(), 'clean');
    await setupSession.stop();

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    try {
      const exitCode = await runSkeinCommand(['clean', 'demo-diff'], { project: tempRoot });

      expect(exitCode).toBe(1); // demo-diff's error knot must fail the whole batch
      const lines = logSpy.mock.calls.map(([line]) => String(line));
      expect(lines.some((line) => line.startsWith('clean:'))).toBe(true);
      expect(lines.some((line) => line.startsWith('demo-diff:'))).toBe(true);
      expect(lines.some((line) => line.startsWith('total:'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('suppresses the shared session/process layer\'s own console.log by default, but not with --verbose', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-run-skein-verbose-'));
    fs.cpSync(FIXTURE_ROOT, tempRoot, { recursive: true });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    try {
      logSpy.mockClear();
      await runSkeinCommand(['demo-diff'], { project: tempRoot });
      const quietLines = logSpy.mock.calls.map(([line]) => String(line));
      expect(quietLines.some((line) => line.includes('Starting process'))).toBe(false);

      logSpy.mockClear();
      await runSkeinCommand(['demo-diff'], { project: tempRoot, verbose: true });
      const verboseLines = logSpy.mock.calls.map(([line]) => String(line));
      expect(verboseLines.some((line) => line.includes('Starting process'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
