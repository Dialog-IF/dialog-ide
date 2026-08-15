import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DialogProject, ExportConfig, SkeinTree } from './dialoged/skein';
import { serializeTree } from './dialoged/skein/persistence';
import { PDF_ASSETS, bundleWebExport, extractStoryInfo, extractWalkthrough } from './dialog-web-export';

describe('extractWalkthrough', () => {
  const ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-web-export-walkthrough-'));

  afterAll(() => {
    fs.rmSync(ROOT_DIR, { recursive: true, force: true });
  });

  function project(): DialogProject {
    return { name: 'Test', sources: { main: ['main'] }, exports: [], rootDir: ROOT_DIR };
  }

  it('returns null when default.skein does not exist', () => {
    expect(extractWalkthrough(project())).toBeNull();
  });

  it('returns null when default.skein has no WALKTHROUGH label', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' }).blessKnot(1);
    fs.writeFileSync(path.join(ROOT_DIR, 'default.skein'), serializeTree(tree));
    expect(extractWalkthrough(project())).toBeNull();
  });

  it('concatenates blessed responses from root to the WALKTHROUGH-labeled knot, skipping "*"-prefixed commands', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You are in a room.\n', inputType: 'line' })
      .blessKnot(1)
      .addChild(1, '* a comment, not a real command', { text: 'ignored\n', inputType: 'line' })
      .blessKnot(2)
      .addChild(1, 'inventory', { text: 'You have nothing.\n', inputType: 'line' })
      .blessKnot(3)
      .setLabel(3, 'WALKTHROUGH');
    fs.writeFileSync(path.join(ROOT_DIR, 'default.skein'), serializeTree(tree));

    const walkthrough = extractWalkthrough(project());
    expect(walkthrough).toBe('You are in a room.\nYou have nothing.\n');
  });
});

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

// Real (non-mocked) integration tests against the actual dialogc/dgdebug/aambundle binaries -
// skip themselves when any is missing, matching dialog-export.spec.ts's describeIfDialogc
// convention so the suite stays portable to machines/CI without the full toolchain.
const describeIfFullToolchain = toolsAvailable(['dialogc', 'dgdebug', 'aambundle']) ? describe : describe.skip;
const describeIfDgdebug = toolsAvailable(['dgdebug']) ? describe : describe.skip;

const FIXTURE_ROOT = path.join(__dirname, 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');
const ASSETS_DIR = path.join(__dirname, '..', 'resources', 'bundle');

describeIfDgdebug('extractStoryInfo (real dgdebug)', () => {
  function project(): DialogProject {
    return {
      name: 'The Orb',
      sources: { main: ['src'], library: ['lib/dialog'] },
      exports: [],
      rootDir: FIXTURE_ROOT
    };
  }

  it('queries title/author/ifid/noun/blurb/release from a real dgdebug session', async () => {
    const story = await extractStoryInfo(project());
    expect(story.title).toBe('The Featureless Space');
    expect(story.author).toBe('The Intrepid Author');
    expect(story.ifid).toBe('DBB9D22A-8BEF-476E-BDA1-C5DFBFFC8127');
    expect(story.blurb).toBe('A short description of the work.');
    expect(story.release).toBe('0');
  }, 20000);
});

describeIfFullToolchain('bundleWebExport (real dialogc/dgdebug/aambundle)', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-web-export-integration-'));
    fs.cpSync(path.join(FIXTURE_ROOT, 'src'), path.join(rootDir, 'main'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_ROOT, 'lib'), path.join(rootDir, 'lib'), { recursive: true });
    fs.copyFileSync(path.join(ASSETS_DIR, 'default-cover.png'), path.join(rootDir, 'cover.png'));
    // Mirrors what "Initialize Dialog Project" seeds at the project root (dialog-project-init.ts).
    for (const asset of PDF_ASSETS) {
      fs.copyFileSync(path.join(ASSETS_DIR, asset.filename), path.join(rootDir, asset.filename));
    }
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function project(dialogcOptions?: string[]): DialogProject {
    return {
      name: 'The Orb',
      sources: { main: ['main'], library: ['lib/dialog'] },
      exports: [],
      rootDir,
      dialogcOptions
    };
  }

  function zblorbConfig(dialogcOptions?: string[]): ExportConfig {
    return { name: 'Release', format: 'zblorb', includeDebug: false, output: 'unused', dialogcOptions };
  }

  it('produces a complete out/web/ directory and zip', async () => {
    const result = await bundleWebExport(
      project(),
      zblorbConfig(),
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );

    expect(result.ok).toBe(true);
    if (result.ok !== true) {
      return;
    }

    for (const expected of [
      'index.html',
      'style.css',
      'introduction-to-if.pdf',
      'play-if-card.pdf',
      'cover.png',
      'cover-small.png',
      'play.html',
      'The Orb.zblorb',
      path.join('resources', 'style.css')
    ]) {
      expect(fs.existsSync(path.join(result.outDir, expected))).toBe(true);
    }

    expect(fs.existsSync(result.zipPath)).toBe(true);

    const html = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8');
    expect(html).toContain('The Featureless Space');
    expect(html).toContain('The Intrepid Author');
    expect(html).toContain('cover-small.png');
    expect(html).toContain('introduction-to-if.pdf');
    expect(html).toContain('play-if-card.pdf');
  }, 60000);

  it('builds only the picked export configuration\'s format as the downloadable story file, and "aa" separately for the player', async () => {
    const result = await bundleWebExport(
      project(),
      zblorbConfig(),
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(result.ok).toBe(true);
    if (result.ok !== true) {
      return;
    }

    // Only the zblorb story file is offered for download - no separate .aastory download link,
    // even though an "aa" build happened behind the scenes to drive the player.
    const html = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8');
    expect(html).toContain('The Orb.zblorb');
    expect(html).not.toContain('.aastory');
  }, 60000);

  it('reuses a single "aa" build for both the story file and the player when the picked configuration targets aa', async () => {
    const result = await bundleWebExport(
      project(),
      { name: 'AA Release', format: 'aa', includeDebug: false, output: 'unused' },
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(result.ok).toBe(true);
    if (result.ok !== true) {
      return;
    }

    expect(fs.existsSync(path.join(result.outDir, 'play.html'))).toBe(true);
    const html = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8');
    expect(html).toContain('The Orb.aastory');
  }, 60000);

  it('omits a deleted PDF from the output directory and the generated page, keeping the other one', async () => {
    fs.rmSync(path.join(rootDir, 'introduction-to-if.pdf'));

    const result = await bundleWebExport(
      project(),
      zblorbConfig(),
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(result.ok).toBe(true);
    if (result.ok !== true) {
      return;
    }

    expect(fs.existsSync(path.join(result.outDir, 'introduction-to-if.pdf'))).toBe(false);
    expect(fs.existsSync(path.join(result.outDir, 'play-if-card.pdf'))).toBe(true);

    const html = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8');
    expect(html).not.toContain('introduction-to-if.pdf');
    expect(html).toContain('play-if-card.pdf');
  }, 60000);

  it('omits both PDFs when neither exists at the project root', async () => {
    for (const asset of PDF_ASSETS) {
      fs.rmSync(path.join(rootDir, asset.filename));
    }

    const result = await bundleWebExport(
      project(),
      zblorbConfig(),
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(result.ok).toBe(true);
    if (result.ok !== true) {
      return;
    }

    const html = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8');
    expect(html).not.toContain('.pdf');
  }, 60000);

  it('reports a failure step and message when dialogc is not actually usable', async () => {
    const result = await bundleWebExport(
      project(),
      zblorbConfig(),
      { dialogcPath: '/nonexistent/dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.step).toBe('build');
    }
  }, 20000);

  it('passes project.dialogcOptions through when the picked configuration has none of its own (real dialogc)', async () => {
    const succeeded = await bundleWebExport(
      project(['--heap', '2000']),
      zblorbConfig(),
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(succeeded.ok).toBe(true);

    // An option dialogc doesn't recognize proves the array actually reaches the real dialogc
    // invocation (rather than, say, silently being dropped) - it fails to build with that option,
    // same project otherwise compiles fine (see the "produces a complete..." test above).
    const failed = await bundleWebExport(
      project(['--not-a-real-dialogc-flag']),
      zblorbConfig(),
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(failed.ok).toBe(false);
    if (failed.ok === false) {
      expect(failed.step).toBe('build');
    }
  }, 60000);

  it('uses the picked configuration\'s own dialogcOptions over the project default', async () => {
    // The config's own (bogus) option should be what's used, not the project's (valid) default -
    // if the project default won out instead, this build would succeed.
    const result = await bundleWebExport(
      project(['--heap', '2000']),
      zblorbConfig(['--not-a-real-dialogc-flag']),
      { dialogcPath: 'dialogc', aambundlePath: 'aambundle' },
      ASSETS_DIR
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.step).toBe('build');
    }
  }, 20000);
});
