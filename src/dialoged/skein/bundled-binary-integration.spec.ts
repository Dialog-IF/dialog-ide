/**
 * Real (non-mocked) integration test for the bundled dgdebug/dialogc binaries staged by
 * scripts/fetch-dialog-binaries.js (see project.ts's resolveBundledBinDir). Mirrors
 * dgdebug-integration.spec.ts's real-binary approach, but exercises the bundled-binary
 * resolution path specifically - no binDir, no PATH dependency, just bin/<platform>-<arch>/.
 *
 * Skips itself (rather than failing) when this repo's bin/ hasn't been staged locally for the
 * current platform/arch, which is the normal case for ordinary development and CI - see
 * CLAUDE.md's Packaging section.
 */

import * as path from 'path';
import { resolveBundledBinDir, resolveCommandPath, readProject, expandSources } from './project';
import { SkeinProcess } from './process';
import { SkeinSession } from './session';

jest.setTimeout(15000);

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = path.join(__dirname, '__fixtures__', 'project', 'dgsample');

const bundledBinDir = resolveBundledBinDir(REPO_ROOT);

const describeIfBundled = bundledBinDir ? describe : describe.skip;

describeIfBundled('Real bundled-binary integration (no mocks, no binDir/PATH)', () => {
  it('resolveCommandPath finds the staged binary directly', () => {
    const resolved = resolveCommandPath(undefined, 'dgdebug', bundledBinDir);
    expect(resolved).toBe(path.join(bundledBinDir!, process.platform === 'win32' ? 'dgdebug.exe' : 'dgdebug'));
  });

  it('SkeinProcess starts and responds using only bundledBinDir', async () => {
    const project = readProject(FIXTURE_ROOT);
    const sourceFiles = expandSources(project, { debug: true, target: 'dgdebug' });

    const proc = new SkeinProcess({ engine: 'dgdebug', seed: 42, sourceFiles, bundledBinDir });
    await proc.start();

    try {
      const banner = await proc.readResponse();
      expect(banner.response).toContain('Endless Featureless Space');
      expect(banner.promptType).toBe('line');
    } finally {
      await proc.terminate();
    }
  });

  it('SkeinSession end-to-end using only bundledBinDir (no binDir set in the fixture project)', async () => {
    const session = SkeinSession.createNew({
      engine: 'dgdebug',
      seed: 42,
      projectRoot: FIXTURE_ROOT,
      bundledBinDir
    });
    await session.start();
    expect(session.isRunningSession()).toBe(true);

    try {
      await session.runCommand('look');
      const tree = session.getTree();
      const activeId = tree.getActiveKnotId()!;
      const knot = tree.getDerivedKnot(activeId)!;
      expect(knot.command).toBe('look');
      expect(knot.unblessedResponse).toContain('You are in an endless, featureless space');
    } finally {
      await session.stop();
    }
  });
});
