/**
 * Real (non-mocked) integration test for `dgbuild bundle` - exercises the actual
 * bundleWebExport pipeline (dialogc compile -> dgdebug story-info query -> aambundle -> assemble
 * out/web/ -> zip) that bundle.spec.ts's pure/validation tests can't cover. Kept unmocked in its
 * own file, matching run-skein-integration.spec.ts's convention; skips itself (rather than
 * failing) when the full dialogc/dgdebug/aambundle toolchain isn't on PATH.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bundleCommand } from './bundle';

function toolsAvailable(names: string[]): boolean {
  return names.every((name) => {
    try {
      execFileSync(name, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
}

const describeIfFullToolchain = toolsAvailable(['dialogc', 'dgdebug', 'aambundle']) ? describe : describe.skip;
const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');

describeIfFullToolchain('bundleCommand (real dialogc/dgdebug/aambundle)', () => {
  jest.setTimeout(90000);

  let tempRoot: string;
  let logSpy: jest.SpyInstance;

  function writeDialogJson(exports: unknown): void {
    fs.writeFileSync(
      path.join(tempRoot, 'dialog.json'),
      JSON.stringify({
        name: 'The Orb',
        sources: { main: ['src'], debug: ['lib/dialog/debug'], library: ['lib/dialog'] },
        exports
      })
    );
  }

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-bundle-integration-'));
    fs.cpSync(FIXTURE_ROOT, tempRoot, { recursive: true });
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('builds out/web/ and a release zip for the sole export configuration when no name is given', async () => {
    writeDialogJson([{ name: 'Web', format: 'aa', includeDebug: false, output: 'out/web.aastory' }]);

    const code = await bundleCommand(undefined, { project: tempRoot });

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tempRoot, 'out', 'web', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'out', 'web', 'play.html'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'out', 'The Orb-0.zip'))).toBe(true);
  });

  it('selects a configuration by name when several are defined', async () => {
    writeDialogJson([
      { name: 'Story', format: 'zblorb', includeDebug: false, output: 'out/story.zblorb' },
      { name: 'Web', format: 'aa', includeDebug: false, output: 'out/web.aastory' }
    ]);

    const code = await bundleCommand('Web', { project: tempRoot });

    expect(code).toBe(0);
    const html = fs.readFileSync(path.join(tempRoot, 'out', 'web', 'index.html'), 'utf8');
    expect(html).toContain('The Orb.aastory');
  });

  it('refuses an ambiguous bundle (several configs, no name) without running dialogc', async () => {
    writeDialogJson([
      { name: 'Story', format: 'zblorb', includeDebug: false, output: 'out/story.zblorb' },
      { name: 'Web', format: 'aa', includeDebug: false, output: 'out/web.aastory' }
    ]);

    await expect(bundleCommand(undefined, { project: tempRoot })).rejects.toThrow('Story, Web');
    expect(fs.existsSync(path.join(tempRoot, 'out', 'web'))).toBe(false);
  });
});
