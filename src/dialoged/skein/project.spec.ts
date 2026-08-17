import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readProject,
  expandSources,
  resolveCommandPath,
  resolveBundledBinDir,
  isFileCoveredBySource,
  DialogProject
} from './project';

const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'project');
const DGSAMPLE_DIR = path.join(FIXTURES_DIR, 'dgsample');
const TARGET_FILTER_DIR = path.join(FIXTURES_DIR, 'target-filter');

describe('readProject', () => {
  it('parses name and sources', () => {
    const project = readProject(DGSAMPLE_DIR);
    expect(project.name).toBe('The Orb');
    expect(project.sources.main).toEqual(['src']);
    expect(project.sources.debug).toEqual(['lib/dialog/debug']);
    expect(project.sources.library).toEqual(['lib/dialog']);
  });

  it('throws when dialog.json does not exist', () => {
    expect(() => readProject(path.join(FIXTURES_DIR, 'does-not-exist'))).toThrow('does not exist');
  });

  describe('exports parsing', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-project-exports-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeDialogJson(exports: unknown): void {
      fs.writeFileSync(
        path.join(tmpDir, 'dialog.json'),
        JSON.stringify({ name: 'Test', sources: { main: ['src'] }, exports }, null, 2)
      );
    }

    it('defaults to an empty array when exports is absent', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'dialog.json'),
        JSON.stringify({ name: 'Test', sources: { main: ['src'] } }, null, 2)
      );
      expect(readProject(tmpDir).exports).toEqual([]);
    });

    it('parses well-formed entries, defaulting includeDebug to false when absent', () => {
      writeDialogJson([
        { name: 'Release', format: 'zblorb', output: 'build/release.zblorb' },
        { name: 'Debug build', format: 'z8', includeDebug: true, output: 'build/debug.z8' }
      ]);
      expect(readProject(tmpDir).exports).toEqual([
        { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/release.zblorb' },
        { name: 'Debug build', format: 'z8', includeDebug: true, output: 'build/debug.z8' }
      ]);
    });

    it('skips (rather than throwing on) an entry missing a required field', () => {
      const warnSpy = jest.spyOn(console, 'warn');
      writeDialogJson([
        { name: 'Release', format: 'zblorb', output: 'build/release.zblorb' },
        { name: 'Broken', format: 'zblorb' }
      ]);
      expect(readProject(tmpDir).exports).toEqual([
        { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/release.zblorb' }
      ]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Broken'));
    });

    it('treats a non-array exports value as empty', () => {
      writeDialogJson('not-an-array');
      expect(readProject(tmpDir).exports).toEqual([]);
    });

    it('parses a per-export dialogcOptions array', () => {
      writeDialogJson([
        { name: 'Release', format: 'zblorb', output: 'build/release.zblorb', dialogcOptions: ['--heap', '2000'] }
      ]);
      expect(readProject(tmpDir).exports).toEqual([
        {
          name: 'Release',
          format: 'zblorb',
          includeDebug: false,
          output: 'build/release.zblorb',
          dialogcOptions: ['--heap', '2000']
        }
      ]);
    });

    it('omits dialogcOptions from a parsed export when malformed (not a string array)', () => {
      writeDialogJson([
        { name: 'Release', format: 'zblorb', output: 'build/release.zblorb', dialogcOptions: ['--heap', 2000] }
      ]);
      expect(readProject(tmpDir).exports).toEqual([
        { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/release.zblorb' }
      ]);
    });
  });

  describe('feelies parsing', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-project-feelies-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeDialogJson(feelies: unknown): void {
      fs.writeFileSync(
        path.join(tmpDir, 'dialog.json'),
        JSON.stringify({ name: 'Test', sources: { main: ['src'] }, feelies }, null, 2)
      );
    }

    it('defaults to an empty array when feelies is absent', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'dialog.json'),
        JSON.stringify({ name: 'Test', sources: { main: ['src'] } }, null, 2)
      );
      expect(readProject(tmpDir).feelies).toEqual([]);
    });

    it('parses well-formed entries', () => {
      writeDialogJson([
        { path: 'intro.pdf', name: 'Introduction to IF' },
        { path: 'card.pdf', name: 'IF in One Page' }
      ]);
      expect(readProject(tmpDir).feelies).toEqual([
        { path: 'intro.pdf', name: 'Introduction to IF' },
        { path: 'card.pdf', name: 'IF in One Page' }
      ]);
    });

    it('skips (rather than throwing on) an entry missing a required field', () => {
      const warnSpy = jest.spyOn(console, 'warn');
      writeDialogJson([{ path: 'intro.pdf', name: 'Introduction to IF' }, { path: 'broken.pdf' }]);
      expect(readProject(tmpDir).feelies).toEqual([{ path: 'intro.pdf', name: 'Introduction to IF' }]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broken.pdf'));
    });

    it('treats a non-array feelies value as empty', () => {
      writeDialogJson('not-an-array');
      expect(readProject(tmpDir).feelies).toEqual([]);
    });
  });

  describe('project-level dialogcOptions', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-project-dialogc-options-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('is undefined when absent', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'dialog.json'),
        JSON.stringify({ name: 'Test', sources: { main: ['src'] } }, null, 2)
      );
      expect(readProject(tmpDir).dialogcOptions).toBeUndefined();
    });

    it('parses a string array', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'dialog.json'),
        JSON.stringify(
          { name: 'Test', sources: { main: ['src'] }, dialogcOptions: ['--heap', '2000', '--aux', '1000'] },
          null,
          2
        )
      );
      expect(readProject(tmpDir).dialogcOptions).toEqual(['--heap', '2000', '--aux', '1000']);
    });

    it('is undefined when malformed (not a string array)', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'dialog.json'),
        JSON.stringify({ name: 'Test', sources: { main: ['src'] }, dialogcOptions: 'not-an-array' }, null, 2)
      );
      expect(readProject(tmpDir).dialogcOptions).toBeUndefined();
    });
  });
});

describe('expandSources', () => {
  it('expands a directory source entry into its sorted *.dg files, with library always included but debug omitted', () => {
    const project = readProject(DGSAMPLE_DIR);
    const sources = expandSources(project, {});
    expect(sources).toEqual([
      path.join(DGSAMPLE_DIR, 'src', 'meta.dg'),
      path.join(DGSAMPLE_DIR, 'src', 'orb.dg'),
      path.join(DGSAMPLE_DIR, 'lib', 'dialog', 'stdlib.dg')
    ]);
  });

  it('includes library sources even when debug is not requested', () => {
    const project = readProject(DGSAMPLE_DIR);
    const sources = expandSources(project, {});
    expect(sources).toContain(path.join(DGSAMPLE_DIR, 'lib', 'dialog', 'stdlib.dg'));
  });

  it('orders sources as main, then debug, then library when debug is requested', () => {
    const project = readProject(DGSAMPLE_DIR);
    const sources = expandSources(project, { debug: true });
    expect(sources).toEqual([
      path.join(DGSAMPLE_DIR, 'src', 'meta.dg'),
      path.join(DGSAMPLE_DIR, 'src', 'orb.dg'),
      path.join(DGSAMPLE_DIR, 'lib', 'dialog', 'debug', 'stddebug.dg'),
      path.join(DGSAMPLE_DIR, 'lib', 'dialog', 'stdlib.dg')
    ]);
  });

  it('omits debug sources when debug is not requested', () => {
    const project = readProject(DGSAMPLE_DIR);
    const sources = expandSources(project, { debug: false });
    expect(sources).not.toContain(path.join(DGSAMPLE_DIR, 'lib', 'dialog', 'debug', 'stddebug.dg'));
  });

  it('prepends prePatch entries before main', () => {
    const project = readProject(DGSAMPLE_DIR);
    const patchPath = path.join(DGSAMPLE_DIR, 'src', 'meta.dg');
    const sources = expandSources(project, { prePatch: [patchPath] });
    expect(sources[0]).toBe(patchPath);
  });

  it('warns and skips (rather than throwing) when a source entry does not exist', () => {
    const warnSpy = jest.spyOn(console, 'warn');
    const project: DialogProject = {
      name: 'broken',
      exports: [],
      sources: { main: ['does-not-exist'] },
      rootDir: DGSAMPLE_DIR
    };
    expect(expandSources(project, {})).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('does-not-exist'));
  });

  describe('target-suffix filtering (against dialog-tool\'s own target-filter fixture)', () => {
    it('includes every *.dg file, target-suffixed or not, when no target is given', () => {
      const project = readProject(TARGET_FILTER_DIR);
      const sources = expandSources(project, {});
      expect(sources.map((p) => path.basename(p))).toEqual([
        'always.dg',
        'never.whatsit.dg',
        'sometimes.aa.dg',
        'sometimes.zblorb.dg'
      ]);
    });

    it('includes non-suffixed files plus only the matching target when target "zblorb" is given', () => {
      const project = readProject(TARGET_FILTER_DIR);
      const sources = expandSources(project, { target: 'zblorb' });
      expect(sources.map((p) => path.basename(p))).toEqual(['always.dg', 'sometimes.zblorb.dg']);
    });

    it('includes non-suffixed files plus only the matching target when target "aa" is given', () => {
      const project = readProject(TARGET_FILTER_DIR);
      const sources = expandSources(project, { target: 'aa' });
      expect(sources.map((p) => path.basename(p))).toEqual(['always.dg', 'sometimes.aa.dg']);
    });
  });
});

describe('isFileCoveredBySource', () => {
  it('covers a file inside a declared main directory', () => {
    const project = readProject(DGSAMPLE_DIR);
    expect(isFileCoveredBySource(project, path.join(DGSAMPLE_DIR, 'src', 'orb.dg'))).toBe(true);
  });

  it('covers a file inside a declared library directory', () => {
    const project = readProject(DGSAMPLE_DIR);
    expect(isFileCoveredBySource(project, path.join(DGSAMPLE_DIR, 'lib', 'dialog', 'stdlib.dg'))).toBe(true);
  });

  it('covers a file inside a declared test-only directory, unlike expandSources({}) which omits it', () => {
    // lib/dialog/debug happens to exist on disk from the debug fixture - reused here as a stand-in
    // "test" directory purely to exercise the test-category branch without a dedicated fixture.
    const project: DialogProject = {
      name: 'stand-in',
      exports: [],
      sources: { main: ['src'], test: ['lib/dialog/debug'] },
      rootDir: DGSAMPLE_DIR
    };
    const filePath = path.join(DGSAMPLE_DIR, 'lib', 'dialog', 'debug', 'stddebug.dg');
    expect(isFileCoveredBySource(project, filePath)).toBe(true);
    expect(expandSources(project, {})).not.toContain(filePath);
  });

  it('covers a file matched by an exact-file source entry', () => {
    const project: DialogProject = {
      name: 'stand-in',
      exports: [],
      sources: { main: [path.join('src', 'meta.dg')] },
      rootDir: DGSAMPLE_DIR
    };
    expect(isFileCoveredBySource(project, path.join(DGSAMPLE_DIR, 'src', 'meta.dg'))).toBe(true);
  });

  it('does not cover a file in a directory not declared as any source', () => {
    const project = readProject(DGSAMPLE_DIR);
    expect(isFileCoveredBySource(project, path.join(DGSAMPLE_DIR, 'scratch', 'stray.dg'))).toBe(false);
  });

  it('does not cover a file that is merely a sibling of an exact-file source entry', () => {
    const project: DialogProject = {
      name: 'stand-in',
      exports: [],
      sources: { main: [path.join('src', 'meta.dg')] },
      rootDir: DGSAMPLE_DIR
    };
    expect(isFileCoveredBySource(project, path.join(DGSAMPLE_DIR, 'src', 'orb.dg'))).toBe(false);
  });
});

describe('resolveCommandPath', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('resolves to the bare command name (relying on PATH) when no binDir is given', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(resolveCommandPath(undefined, 'dgdebug')).toBe('dgdebug');
  });

  it('joins binDir and the command name when binDir is given', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(resolveCommandPath('/opt/dialog/bin', 'dgdebug')).toBe(path.join('/opt/dialog/bin', 'dgdebug'));
  });

  it('appends .exe on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(resolveCommandPath(undefined, 'dgdebug')).toBe('dgdebug.exe');
  });

  it('falls back to bundledBinDir when no binDir is given', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(resolveCommandPath(undefined, 'dgdebug', '/ext/bin/darwin-arm64')).toBe(
      path.join('/ext/bin/darwin-arm64', 'dgdebug')
    );
  });

  it('prefers binDir over bundledBinDir when both are given', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(resolveCommandPath('/opt/dialog/bin', 'dgdebug', '/ext/bin/darwin-arm64')).toBe(
      path.join('/opt/dialog/bin', 'dgdebug')
    );
  });
});

describe('resolveBundledBinDir', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-ide-bundled-bin-'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'arch', { value: originalArch });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns the platform-arch subdir when a bundled dgdebug is present', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    const binDir = path.join(tempDir, 'bin', 'darwin-arm64');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'dgdebug'), '');

    expect(resolveBundledBinDir(tempDir)).toBe(binDir);
  });

  it('returns undefined when no bundled binary exists for this platform/arch', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'x64' });

    expect(resolveBundledBinDir(tempDir)).toBeUndefined();
  });

  it('looks for dgdebug.exe on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    Object.defineProperty(process, 'arch', { value: 'x64' });
    const binDir = path.join(tempDir, 'bin', 'win32-x64');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'dgdebug.exe'), '');

    expect(resolveBundledBinDir(tempDir)).toBe(binDir);
  });
});
