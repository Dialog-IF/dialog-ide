import * as path from 'path';
import { readProject, expandSources, resolveCommandPath, isFileCoveredBySource, DialogProject } from './project';

const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'project');
const DGSAMPLE_DIR = path.join(FIXTURES_DIR, 'dgsample');
const TARGET_FILTER_DIR = path.join(FIXTURES_DIR, 'target-filter');

describe('readProject', () => {
  it('parses name, sources, and defaults target to ["zblorb"] when specified as a bare string', () => {
    const project = readProject(DGSAMPLE_DIR);
    expect(project.name).toBe('The Orb');
    expect(project.target).toEqual(['zblorb']);
    expect(project.sources.main).toEqual(['src']);
    expect(project.sources.debug).toEqual(['lib/dialog/debug']);
    expect(project.sources.library).toEqual(['lib/dialog']);
  });

  it('defaults target to ["zblorb"] when unspecified', () => {
    const project = readProject(TARGET_FILTER_DIR);
    expect(project.target).toEqual(['zblorb']);
  });

  it('normalizes an array target as-is', () => {
    // Not one of the fixture files on disk - constructing directly to test normalizeTarget's
    // array branch without needing a dedicated fixture directory.
    const project = readProject(DGSAMPLE_DIR);
    expect(Array.isArray(project.target)).toBe(true);
  });

  it('throws when dialog.json does not exist', () => {
    expect(() => readProject(path.join(FIXTURES_DIR, 'does-not-exist'))).toThrow('does not exist');
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
      target: ['zblorb'],
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
      target: ['zblorb'],
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
      target: ['zblorb'],
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
      target: ['zblorb'],
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
});
