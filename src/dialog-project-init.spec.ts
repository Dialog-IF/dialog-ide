import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { scaffoldProject } from './dialog-project-init';

const execFileAsync = promisify(execFile);

describe('scaffoldProject', () => {
  let rootDir: string;
  let libraryDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-init-root-'));
    libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-init-lib-'));
    fs.writeFileSync(path.join(libraryDir, 'stdlib.dg'), '; stdlib contents\n');
    fs.writeFileSync(path.join(libraryDir, 'stddebug.dg'), '; stddebug contents\n');
    fs.writeFileSync(path.join(libraryDir, 'unit.dg'), '; unit contents\n');
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(libraryDir, { recursive: true, force: true });
  });

  it('creates main/lib/debug/test directories', () => {
    scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir);

    for (const dir of ['main', 'lib', 'debug', 'test']) {
      expect(fs.statSync(path.join(rootDir, dir)).isDirectory()).toBe(true);
    }
  });

  it('writes a starter main/meta.dg with story metadata and a fresh IFID', () => {
    scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir);

    const metaDg = fs.readFileSync(path.join(rootDir, 'main', 'meta.dg'), 'utf8');
    expect(metaDg).toContain('(story title)');
    expect(metaDg).toContain('(story author)');
    // zblorb (dialog.json's default target) requires (story ifid) to compile at all - confirmed
    // against a real dialogc run.
    expect(metaDg).toMatch(/\(story ifid\) [0-9A-F-]{36}/);
  });

  it('writes a starter main/story.dg with a room+player pair so dgdebug/skein get a real interactive loop', () => {
    scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir);

    const storyDg = fs.readFileSync(path.join(rootDir, 'main', 'story.dg'), 'utf8');
    expect(storyDg).toContain('(room *)');
    expect(storyDg).toContain('(current player *)');
  });

  it('generates a different IFID for each scaffolded project', () => {
    scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir);
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-init-root2-'));
    try {
      scaffoldProject(otherRoot, { name: 'The Orb', targets: ['zblorb'] }, libraryDir);
      const first = fs.readFileSync(path.join(rootDir, 'main', 'meta.dg'), 'utf8');
      const second = fs.readFileSync(path.join(otherRoot, 'main', 'meta.dg'), 'utf8');
      expect(first).not.toBe(second);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('writes dialog.json wiring each library file into the category that needs it', () => {
    scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb', 'z8'] }, libraryDir);

    const dialogJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'dialog.json'), 'utf8'));
    expect(dialogJson).toEqual({
      name: 'The Orb',
      target: ['zblorb', 'z8'],
      sources: {
        main: ['main'],
        test: ['test', 'lib/unit.dg'],
        debug: ['debug', 'lib/stddebug.dg'],
        library: ['lib/stdlib.dg']
      }
    });
  });

  it('copies all three standard library files into lib/', () => {
    scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir);

    expect(fs.readFileSync(path.join(rootDir, 'lib', 'stdlib.dg'), 'utf8')).toBe('; stdlib contents\n');
    expect(fs.readFileSync(path.join(rootDir, 'lib', 'stddebug.dg'), 'utf8')).toBe('; stddebug contents\n');
    expect(fs.readFileSync(path.join(rootDir, 'lib', 'unit.dg'), 'utf8')).toBe('; unit contents\n');
  });

  it('throws rather than overwriting an existing dialog.json', () => {
    fs.writeFileSync(path.join(rootDir, 'dialog.json'), '{}');
    expect(() => scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir)).toThrow(
      'already exists'
    );
  });

  it('throws a clear error when no bundled library directory is available', () => {
    expect(() => scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, undefined)).toThrow(
      'fetch-dialog-binaries'
    );
  });

  describe('cover image seeding', () => {
    let coverSource: string;

    beforeEach(() => {
      coverSource = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-init-cover-')), 'default-cover.png');
      fs.writeFileSync(coverSource, 'not really a png');
    });

    it('copies coverImageSource to cover.png when given and it exists', () => {
      scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir, coverSource);
      expect(fs.readFileSync(path.join(rootDir, 'cover.png'), 'utf8')).toBe('not really a png');
    });

    it('writes no cover.png when coverImageSource is omitted', () => {
      scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir);
      expect(fs.existsSync(path.join(rootDir, 'cover.png'))).toBe(false);
    });

    it('writes no cover.png when coverImageSource does not exist', () => {
      scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb'] }, libraryDir, path.join(rootDir, 'missing.png'));
      expect(fs.existsSync(path.join(rootDir, 'cover.png'))).toBe(false);
    });
  });

  function isDialogcAvailable(): boolean {
    try {
      execFileSync('dialogc', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // Real (non-mocked) integration test: compiles the actual scaffolded output with the real
  // dialogc binary, for both the default zblorb target (which needs the generated IFID) and z8 -
  // catches exactly the kind of bug found while building this feature (a bare print-and-exit
  // starter compiles fine but never enters dgdebug/skein's interactive loop). Skips itself when
  // dialogc isn't on PATH, matching dgdebug-integration.spec.ts's portability convention.
  const testIfDialogc = isDialogcAvailable() ? it : it.skip;

  testIfDialogc('the scaffolded project compiles cleanly with real dialogc for zblorb and z8', async () => {
    scaffoldProject(rootDir, { name: 'The Orb', targets: ['zblorb', 'z8'] }, libraryDir);
    // Real stdlib.dg (the same fixture dgdebug-integration.spec.ts uses, checked into git), not
    // the dummy placeholder libraryDir content the other tests here use - dialogc needs the real
    // library to resolve (room *)/(current player *) etc.
    const realStdlib = path.join(
      __dirname,
      'dialoged',
      'skein',
      '__fixtures__',
      'project',
      'dgsample',
      'lib',
      'dialog',
      'stdlib.dg'
    );
    fs.copyFileSync(realStdlib, path.join(rootDir, 'lib', 'stdlib.dg'));

    const sourceFiles = [path.join(rootDir, 'main', 'meta.dg'), path.join(rootDir, 'main', 'story.dg'), path.join(rootDir, 'lib', 'stdlib.dg')];
    for (const format of ['zblorb', 'z8']) {
      await execFileAsync('dialogc', ['-t', format, '-o', path.join(rootDir, `out.${format}`), ...sourceFiles]);
      expect(fs.existsSync(path.join(rootDir, `out.${format}`))).toBe(true);
    }
  });
});
