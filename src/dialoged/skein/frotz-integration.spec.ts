/**
 * Real (non-mocked) integration test: compiles the dgsample fixture project via the real dialogc
 * binary (frotz-build.ts's buildFrotzGame) and drives it against the real dfrotz binary, through
 * project.ts -> session.ts/frotz-build.ts/process.ts -> io.ts, with nothing mocked - the
 * frotz/frotz-release counterpart to dgdebug-integration.spec.ts.
 *
 * Skips itself (rather than failing) when dialogc or dfrotz aren't on PATH, so the rest of the
 * suite stays portable to machines/CI without the Dialog toolchain (or frotz) installed.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkeinSession } from './session';

jest.setTimeout(30000);

const FIXTURE_ROOT = path.join(__dirname, '__fixtures__', 'project', 'dgsample');
const PATCH_SOURCE_PATH = path.join(__dirname, '..', '..', '..', 'resources', 'dfrotz-skein-patch.dg');

function isDialogcAvailable(): boolean {
  try {
    execFileSync('dialogc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// dfrotz has no --version flag (an unrecognized flag exits 1) - called with no arguments at all
// instead, which prints its usage text and exits 0 without reading stdin.
function isDfrotzAvailable(): boolean {
  try {
    execFileSync('dfrotz', [], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfFrotzToolchain = isDialogcAvailable() && isDfrotzAvailable() ? describe : describe.skip;

describeIfFrotzToolchain('Real frotz/dfrotz integration (no mocks)', () => {
  describe('SkeinSession end-to-end for frotz', () => {
    it('compiles, starts, and runs real commands, with no stray status-bar line in the transcript', async () => {
      const session = SkeinSession.createNew({ engine: 'frotz', seed: 42, projectRoot: FIXTURE_ROOT, patchSourcePath: PATCH_SOURCE_PATH });
      await session.start();
      expect(session.isRunningSession()).toBe(true);

      try {
        const knot0 = session.getTree().getDerivedKnot(0)!;
        // The dfrotz-skein-patch.dg no-op keeps the status bar from ever landing inline - if the
        // patch weren't applied, the banner would carry a stray "Endless Featureless Space  Score:
        // ..."-style status line instead of clean game text.
        expect(knot0.response).toContain('Endless Featureless Space');
        expect(knot0.response).toContain('an endless, featureless space');
        expect(knot0.response).not.toMatch(/Score:\s*\d+\s*Moves:\s*\d+/);

        await session.runCommand('look');
        const tree = session.getTree();
        const activeId = tree.getActiveKnotId()!;
        const knot = tree.getDerivedKnot(activeId)!;
        expect(knot.command).toBe('look');
        // Regression check: dfrotz never echoes what it read from stdin on its own (unlike
        // dgdebug's --transcripting) - process.ts's sendCommand synthesizes the same "> <command>"
        // echo dgdebug produces natively, into its own read buffer. Without that, this would come
        // back as "> " immediately glued onto frotz's own first response line, no command text, no
        // newline in between - see dgdebug-integration.spec.ts's equivalent assertion.
        expect(knot.unblessedResponse!.startsWith('> look\n')).toBe(true);
        expect(knot.unblessedResponse).toContain('You are in an endless, featureless space');
        expect(knot.unblessedResponse).not.toMatch(/Score:\s*\d+\s*Moves:\s*\d+/);
      } finally {
        await session.stop();
      }
    });

    it('never captures dynamic state or supports tracing - dgdebug-only concepts', async () => {
      const session = SkeinSession.createNew({ engine: 'frotz', seed: 42, projectRoot: FIXTURE_ROOT, patchSourcePath: PATCH_SOURCE_PATH });
      await session.start();

      try {
        expect(session.getTree().getDynamicState(0)).toBeNull();
        await expect(session.traceStartup()).resolves.toBeNull();
      } finally {
        await session.stop();
      }
    });
  });

  describe('frotz-release excludes debug sources', () => {
    it('starts successfully with the debug-category sources excluded from compilation', async () => {
      const session = SkeinSession.createNew({
        engine: 'frotz-release',
        seed: 42,
        projectRoot: FIXTURE_ROOT,
        patchSourcePath: PATCH_SOURCE_PATH
      });
      await session.start();
      try {
        expect(session.isRunningSession()).toBe(true);
      } finally {
        await session.stop();
      }
    });
  });

  describe('DialogCompileError against the real dialogc compile step', () => {
    let tempRoot: string;

    beforeEach(() => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frotz-compile-error-test-'));
      fs.cpSync(FIXTURE_ROOT, tempRoot, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('rejects session.start() with a DialogCompileError carrying the real file path', async () => {
      const orbPath = path.join(tempRoot, 'src', 'orb.dg');
      fs.appendFileSync(orbPath, ')\n');

      const session = SkeinSession.createNew({
        engine: 'frotz',
        seed: 42,
        projectRoot: tempRoot,
        patchSourcePath: PATCH_SOURCE_PATH
      });

      await expect(session.start()).rejects.toMatchObject({
        name: 'DialogCompileError',
        filePath: orbPath
      });
      expect(session.isRunningSession()).toBe(false);
    });
  });
});
