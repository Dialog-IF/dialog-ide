import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DialogProject, ExportConfig } from './dialoged/skein';
import {
  addExportConfig,
  buildDialogcArgs,
  defaultOutputPath,
  parseDialogcOptionsInput,
  removeExportConfig,
  resolveCoverImage,
  resolveDialogcOptions,
  runDialogcExport,
  setProjectDialogcOptions
} from './dialog-export';

describe('addExportConfig', () => {
  let tmpDir: string;
  let dialogJsonPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-export-'));
    dialogJsonPath = path.join(tmpDir, 'dialog.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the exports array when it does not exist yet', () => {
    fs.writeFileSync(dialogJsonPath, JSON.stringify({ name: 'Test', sources: { main: ['src'] } }, null, 2));

    addExportConfig(dialogJsonPath, { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' });

    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.exports).toEqual([{ name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' }]);
  });

  it('appends to an existing exports array without disturbing other entries', () => {
    fs.writeFileSync(
      dialogJsonPath,
      JSON.stringify(
        { name: 'Test', sources: { main: ['src'] }, exports: [{ name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' }] },
        null,
        2
      )
    );

    addExportConfig(dialogJsonPath, { name: 'Debug', format: 'z8', includeDebug: true, output: 'build/d.z8' });

    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.exports).toEqual([
      { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' },
      { name: 'Debug', format: 'z8', includeDebug: true, output: 'build/d.z8' }
    ]);
  });
});

describe('removeExportConfig', () => {
  let tmpDir: string;
  let dialogJsonPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-export-'));
    dialogJsonPath = path.join(tmpDir, 'dialog.json');
    fs.writeFileSync(
      dialogJsonPath,
      JSON.stringify(
        {
          name: 'Test',
          sources: { main: ['src'] },
          exports: [
            { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' },
            { name: 'Debug', format: 'z8', includeDebug: true, output: 'build/d.z8' }
          ]
        },
        null,
        2
      )
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the named entry, leaving others intact', () => {
    removeExportConfig(dialogJsonPath, 'Release');
    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.exports).toEqual([{ name: 'Debug', format: 'z8', includeDebug: true, output: 'build/d.z8' }]);
  });

  it('is a no-op when the name is not found', () => {
    removeExportConfig(dialogJsonPath, 'Does Not Exist');
    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.exports).toHaveLength(2);
  });
});

describe('defaultOutputPath', () => {
  it('slugifies the name into build/<slug>.<format>', () => {
    expect(defaultOutputPath({ name: 'Release zblorb', format: 'zblorb' })).toBe('build/release-zblorb.zblorb');
  });

  it('collapses non-alphanumeric runs and trims leading/trailing dashes', () => {
    expect(defaultOutputPath({ name: '  Beta (v2)!! ', format: 'z8' })).toBe('build/beta-v2.z8');
  });

  it('falls back to "export" for a name with no alphanumeric characters', () => {
    expect(defaultOutputPath({ name: '!!!', format: 'aa' })).toBe('build/export.aa');
  });
});

describe('buildDialogcArgs', () => {
  const FIXTURE_ROOT = path.join(__dirname, 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');

  function project(): DialogProject {
    return {
      name: 'The Orb',
      sources: { main: ['src'], debug: ['lib/dialog/debug'], library: ['lib/dialog'] },
      exports: [],
      rootDir: FIXTURE_ROOT
    };
  }

  it('builds -t/-o followed by the expanded, non-debug source files by default', () => {
    const config: ExportConfig = { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' };
    const args = buildDialogcArgs(project(), config);
    expect(args.slice(0, 4)).toEqual(['-t', 'zblorb', '-o', path.join(FIXTURE_ROOT, 'build', 'r.zblorb')]);
    expect(args.slice(4).some((p) => p.includes(path.join('lib', 'dialog', 'debug')))).toBe(false);
  });

  it('includes debug sources when includeDebug is true', () => {
    const config: ExportConfig = { name: 'Debug', format: 'z8', includeDebug: true, output: 'build/d.z8' };
    const args = buildDialogcArgs(project(), config);
    expect(args.some((p) => p.includes(path.join('lib', 'dialog', 'debug')))).toBe(true);
  });

  it('leaves an absolute output path untouched', () => {
    const absolute = path.join(os.tmpdir(), 'out.zblorb');
    const config: ExportConfig = { name: 'Release', format: 'zblorb', includeDebug: false, output: absolute };
    const args = buildDialogcArgs(project(), config);
    expect(args[3]).toBe(absolute);
  });

  describe('cover image', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-export-cover-'));
      fs.mkdirSync(path.join(tmpDir, 'src'));
      fs.writeFileSync(path.join(tmpDir, 'src', 'main.dg'), '');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function projectWithCover(): DialogProject {
      return {
        name: 'The Orb',
        sources: { main: ['src'] },
        exports: [],
        rootDir: tmpDir
      };
    }

    it('adds no --cover flags when cover.png does not exist', () => {
      const config: ExportConfig = { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' };
      const args = buildDialogcArgs(projectWithCover(), config);
      expect(args).not.toContain('--cover');
    });

    it('bakes in --cover/--cover-alt for a zblorb export when cover.png exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'cover.png'), 'not really a png');
      const config: ExportConfig = { name: 'Release', format: 'zblorb', includeDebug: false, output: 'build/r.zblorb' };
      const args = buildDialogcArgs(projectWithCover(), config);
      const coverIndex = args.indexOf('--cover');
      expect(coverIndex).toBeGreaterThan(-1);
      expect(args[coverIndex + 1]).toBe(path.join(tmpDir, 'cover.png'));
      expect(args[coverIndex + 2]).toBe('--cover-alt');
      expect(args[coverIndex + 3]).toBe('The Orb');
    });

    it('does not add --cover for a non-zblorb format even when cover.png exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'cover.png'), 'not really a png');
      const config: ExportConfig = { name: 'Release', format: 'z8', includeDebug: false, output: 'build/r.z8' };
      const args = buildDialogcArgs(projectWithCover(), config);
      expect(args).not.toContain('--cover');
    });

    it('resolveCoverImage returns null when no cover.png exists', () => {
      expect(resolveCoverImage(tmpDir)).toBeNull();
    });

    it('resolveCoverImage returns the path when cover.png exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'cover.png'), 'not really a png');
      expect(resolveCoverImage(tmpDir)).toBe(path.join(tmpDir, 'cover.png'));
    });
  });
});

describe('parseDialogcOptionsInput', () => {
  it('splits on whitespace', () => {
    expect(parseDialogcOptionsInput('--heap 2000 --aux 1000')).toEqual(['--heap', '2000', '--aux', '1000']);
  });

  it('collapses runs of whitespace', () => {
    expect(parseDialogcOptionsInput('  --heap   2000  ')).toEqual(['--heap', '2000']);
  });

  it('returns [] for blank input', () => {
    expect(parseDialogcOptionsInput('')).toEqual([]);
    expect(parseDialogcOptionsInput('   ')).toEqual([]);
  });
});

describe('resolveDialogcOptions', () => {
  function project(dialogcOptions?: string[]): DialogProject {
    return { name: 'Test', sources: { main: ['src'] }, exports: [], rootDir: '/tmp/unused', dialogcOptions };
  }

  it('uses the config\'s own dialogcOptions when set', () => {
    expect(resolveDialogcOptions(project(['--heap', '1000']), { dialogcOptions: ['--heap', '5000'] })).toEqual([
      '--heap',
      '5000'
    ]);
  });

  it('falls back to the project default when the config has none', () => {
    expect(resolveDialogcOptions(project(['--heap', '1000']), {})).toEqual(['--heap', '1000']);
  });

  it('is [] when neither the config nor the project has any', () => {
    expect(resolveDialogcOptions(project(), {})).toEqual([]);
  });
});

describe('buildDialogcArgs dialogcOptions', () => {
  function project(dialogcOptions?: string[]): DialogProject {
    return { name: 'Test', sources: { main: ['src'] }, exports: [], rootDir: '/tmp/unused', dialogcOptions };
  }

  it('appends the config\'s own dialogcOptions', () => {
    const config: ExportConfig = {
      name: 'Release',
      format: 'z8',
      includeDebug: false,
      output: 'build/r.z8',
      dialogcOptions: ['--heap', '2000']
    };
    const args = buildDialogcArgs(project(), config);
    expect(args).toEqual(expect.arrayContaining(['--heap', '2000']));
  });

  it('falls back to the project default when the config has none', () => {
    const config: ExportConfig = { name: 'Release', format: 'z8', includeDebug: false, output: 'build/r.z8' };
    const args = buildDialogcArgs(project(['--aux', '1000']), config);
    expect(args).toEqual(expect.arrayContaining(['--aux', '1000']));
  });
});

describe('setProjectDialogcOptions', () => {
  let tmpDir: string;
  let dialogJsonPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-export-project-options-'));
    dialogJsonPath = path.join(tmpDir, 'dialog.json');
    fs.writeFileSync(dialogJsonPath, JSON.stringify({ name: 'Test', sources: { main: ['src'] } }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds dialogcOptions when none existed', () => {
    setProjectDialogcOptions(dialogJsonPath, ['--heap', '2000']);
    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.dialogcOptions).toEqual(['--heap', '2000']);
  });

  it('replaces an existing dialogcOptions value', () => {
    setProjectDialogcOptions(dialogJsonPath, ['--heap', '2000']);
    setProjectDialogcOptions(dialogJsonPath, ['--aux', '1000']);
    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.dialogcOptions).toEqual(['--aux', '1000']);
  });

  it('removes the field when given an empty array', () => {
    setProjectDialogcOptions(dialogJsonPath, ['--heap', '2000']);
    setProjectDialogcOptions(dialogJsonPath, []);
    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.dialogcOptions).toBeUndefined();
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

// Real (non-mocked) integration test against the actual dialogc binary - skips itself when
// dialogc isn't on PATH, matching dgdebug-integration.spec.ts's portability convention.
const describeIfDialogc = isDialogcAvailable() ? describe : describe.skip;

describeIfDialogc('runDialogcExport (real dialogc)', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-export-integration-'));
    fs.mkdirSync(path.join(rootDir, 'main'));
    fs.writeFileSync(path.join(rootDir, 'main', 'main.dg'), '(program entry point)\n\thello world\n');
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function project(): DialogProject {
    return {
      name: 'Test',
      sources: { main: ['main'] },
      exports: [],
      rootDir
    };
  }

  it('compiles a real z8 file on success', async () => {
    const config: ExportConfig = { name: 'Release', format: 'z8', includeDebug: false, output: 'build/out.z8' };
    const result = await runDialogcExport(project(), config, 'dialogc');
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(fs.existsSync(result.outputPath)).toBe(true);
    }
  });

  it('parses the file/line out of a real compile failure', async () => {
    fs.writeFileSync(path.join(rootDir, 'main', 'main.dg'), '(program entry point\n');
    const config: ExportConfig = { name: 'Release', format: 'z8', includeDebug: false, output: 'build/out.z8' };
    const result = await runDialogcExport(project(), config, 'dialogc');
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      // dialogc reports the error using the path as given on its commandline - buildDialogcArgs
      // passes expandSources' absolute paths, so this is the absolute path, not a bare filename.
      expect(result.filePath).toBe(path.join(rootDir, 'main', 'main.dg'));
      expect(result.line).toBe(2);
    }
  });
});
