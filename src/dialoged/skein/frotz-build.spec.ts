/**
 * Real (non-mocked) integration test against the actual dialogc binary - skips itself when
 * dialogc isn't on PATH, matching dgdebug-integration.spec.ts/dialog-export.spec.ts's portability
 * convention.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DialogProject, readProject } from './project';
import { DialogCompileError } from './compile-error';
import { buildFrotzGame } from './frotz-build';

// The same real fixture project session.spec.ts/dgdebug-integration.spec.ts use (a complete,
// compilable Dialog project - stdlib, a real (story ifid), etc.) - a minimal hand-rolled source
// file isn't enough here since zblorb output requires a genuine IFID.
const DGSAMPLE_ROOT = path.join(__dirname, '__fixtures__', 'project', 'dgsample');
const PATCH_SOURCE_PATH = path.join(__dirname, '..', '..', '..', 'resources', 'dfrotz-skein-patch.dg');

function isDialogcAvailable(): boolean {
  try {
    execFileSync('dialogc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfDialogc = isDialogcAvailable() ? describe : describe.skip;

describeIfDialogc('buildFrotzGame (real dialogc)', () => {
  function project(): DialogProject {
    return readProject(DGSAMPLE_ROOT);
  }

  it('compiles a real .zblorb and returns its path, for frotz', async () => {
    const gamePath = await buildFrotzGame({ project: project(), engine: 'frotz', patchSourcePath: PATCH_SOURCE_PATH });
    expect(gamePath.endsWith('.zblorb')).toBe(true);
    expect(fs.existsSync(gamePath)).toBe(true);
  });

  it('compiles a real .zblorb and returns its path, for frotz-release', async () => {
    const gamePath = await buildFrotzGame({ project: project(), engine: 'frotz-release', patchSourcePath: PATCH_SOURCE_PATH });
    expect(fs.existsSync(gamePath)).toBe(true);
  });

  it('frotz and frotz-release compile to different paths - each engine gets its own game file', async () => {
    const frotzPath = await buildFrotzGame({ project: project(), engine: 'frotz', patchSourcePath: PATCH_SOURCE_PATH });
    const releasePath = await buildFrotzGame({ project: project(), engine: 'frotz-release', patchSourcePath: PATCH_SOURCE_PATH });
    expect(frotzPath).not.toBe(releasePath);
  });

  it('rebuilds to the same path on a second call - overwrites in place rather than accumulating temp files', async () => {
    const first = await buildFrotzGame({ project: project(), engine: 'frotz', patchSourcePath: PATCH_SOURCE_PATH });
    const second = await buildFrotzGame({ project: project(), engine: 'frotz', patchSourcePath: PATCH_SOURCE_PATH });
    expect(second).toBe(first);
  });

  it('throws DialogCompileError with the parsed file/line on a real compile failure', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frotz-build-broken-'));
    try {
      fs.cpSync(DGSAMPLE_ROOT, tmpDir, { recursive: true });
      const mainFile = path.join(tmpDir, 'src', 'meta.dg');
      const original = fs.readFileSync(mainFile, 'utf8');
      fs.writeFileSync(mainFile, `${original}\n(program entry point\n`);

      try {
        await buildFrotzGame({ project: readProject(tmpDir), engine: 'frotz', patchSourcePath: PATCH_SOURCE_PATH });
        fail('expected buildFrotzGame to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(DialogCompileError);
        const compileError = error as DialogCompileError;
        expect(compileError.filePath).toBe(mainFile);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
