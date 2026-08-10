/**
 * Real (non-mocked) integration test: spawns the actual dgdebug binary against a real fixture
 * project (see project.spec.ts's dgsample fixture) and drives it through project.ts ->
 * session.ts/process.ts -> io.ts/dynamic.ts with nothing mocked. Everywhere else in this suite,
 * process I/O is faked because no real interpreter was assumed to be available - this file is
 * the actual end-to-end correctness check for when one is.
 *
 * Skips itself (rather than failing) when dgdebug isn't on PATH, so the rest of the suite stays
 * portable to machines/CI without the Dialog toolchain installed.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';
import { SkeinProcess } from './process';
import { SkeinSession } from './session';
import { readProject, expandSources } from './project';

jest.setTimeout(15000);

const FIXTURE_ROOT = path.join(__dirname, '__fixtures__', 'project', 'dgsample');

function isDgdebugAvailable(): boolean {
  try {
    execFileSync('dgdebug', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfDgdebug = isDgdebugAvailable() ? describe : describe.skip;

describeIfDgdebug('Real dgdebug integration (no mocks)', () => {
  describe('SkeinProcess against the real dgdebug binary', () => {
    it('starts, captures the real startup output, and responds to real commands', async () => {
      const project = readProject(FIXTURE_ROOT);
      const sourceFiles = expandSources(project, { debug: true, target: 'dgdebug' });

      const proc = new SkeinProcess({ engine: 'dgdebug', seed: 42, sourceFiles });
      await proc.start();

      try {
        const banner = await proc.readResponse();
        // Game content from orb.dg/meta.dg (ours) rather than the interpreter's own version
        // banner, which varies across dgdebug/stdlib versions.
        expect(banner.response).toContain('Endless Featureless Space');
        expect(banner.response).toContain('an endless, featureless space');
        expect(banner.promptType).toBe('line');

        proc.sendCommand('look');
        const lookResponse = await proc.readResponse();
        // Regression check: dgdebug echoes the command back as the literal start of the next
        // response (no fresh tag of its own - see nextBufferSeed in process.ts), so a response
        // that starts with anything other than "> <the exact command just sent>" means that
        // echo got truncated again.
        expect(lookResponse.response.startsWith('> look\n')).toBe(true);
        expect(lookResponse.response).toContain('You are in an endless, featureless space');
        expect(lookResponse.response).toContain('Floating nearby is a small white orb');

        // A longer, multi-word command is what actually exposes truncation (a 1-2 character
        // command's echo can be fully swallowed by a slice(2) bug without any visible symptom).
        proc.sendCommand('take orb');
        const takeResponse = await proc.readResponse();
        expect(takeResponse.response).toBe('> take orb\nYou take the White Orb.\n');

        proc.sendCommand('@dynamic');
        const dynamicResponse = await proc.readResponse();
        expect(dynamicResponse.response).toContain('GLOBAL FLAGS');
        expect(dynamicResponse.response).toContain('PER-OBJECT VARIABLES');
      } finally {
        await proc.terminate();
      }
    });
  });

  describe('SkeinSession end-to-end (project.ts -> session.ts -> process.ts -> io.ts/dynamic.ts)', () => {
    it('runs a real command and produces a correctly parsed tree knot and dynamic state', async () => {
      const session = SkeinSession.createNew({ engine: 'dgdebug', seed: 42, projectRoot: FIXTURE_ROOT });
      await session.start();
      expect(session.isRunningSession()).toBe(true);

      try {
        await session.runCommand('look');

        const tree = session.getTree();
        const activeId = tree.getActiveKnotId()!;
        const knot = tree.getDerivedKnot(activeId)!;
        expect(knot.command).toBe('look');
        expect(knot.unblessedResponse).toContain('You are in an endless, featureless space');
        expect(knot.parentId).toBe(0);

        const dynamicState = session.getTree().getDynamicState(activeId);
        expect(dynamicState).not.toBeNull();
        expect(dynamicState!.flags.size).toBeGreaterThan(0);
      } finally {
        await session.stop();
      }
    });
  });
});
