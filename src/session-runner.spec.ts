import * as path from 'path';
import { SkeinTree, resolveBundledBinDir } from './dialoged/skein';
import {
  DEFAULT_SESSION_ID,
  ENGINE_CHOICES,
  SessionRunnerError,
  debugTerminalShellArgs,
  isDgdebugAvailable,
  isValidSessionId,
  parseSeed,
  randomSeed,
  resolveProjectRoot,
  sessionConfigFromTree,
  toSessionId,
  listSkeinFiles
} from './session-runner';

describe('resolveProjectRoot', () => {
  it('returns the workspace folder path when one is open', () => {
    expect(resolveProjectRoot('/tmp/my-project')).toBe('/tmp/my-project');
  });

  it('throws a SessionRunnerError when no workspace folder is open', () => {
    expect(() => resolveProjectRoot(undefined)).toThrow(SessionRunnerError);
    expect(() => resolveProjectRoot(undefined)).toThrow('Open a folder');
  });
});

describe('toSessionId', () => {
  it('strips a trailing .skein extension', () => {
    expect(toSessionId('default.skein')).toBe('default');
  });

  it('leaves a bare id unchanged', () => {
    expect(toSessionId('default')).toBe('default');
  });

  it('trims surrounding whitespace', () => {
    expect(toSessionId('  my-session.skein  ')).toBe('my-session');
  });
});

describe('isValidSessionId', () => {
  it('accepts a plain name', () => {
    expect(isValidSessionId('default')).toBe(true);
    expect(isValidSessionId('my-session')).toBe(true);
  });

  it('rejects empty, ".", "..", and anything containing a path separator', () => {
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('.')).toBe(false);
    expect(isValidSessionId('..')).toBe(false);
    expect(isValidSessionId('../escape')).toBe(false);
    expect(isValidSessionId('sub/dir')).toBe(false);
    expect(isValidSessionId('sub\\dir')).toBe(false);
  });
});

describe('sessionConfigFromTree', () => {
  it('carries the tree\'s own fixed engine/seed plus the given project root', () => {
    const tree = SkeinTree.newTree('frotz-release', 777);
    expect(sessionConfigFromTree(tree, '/tmp/proj')).toEqual({
      engine: 'frotz-release',
      seed: 777,
      projectRoot: '/tmp/proj'
    });
  });

  it('carries bundledBinDir through when given', () => {
    const tree = SkeinTree.newTree('dgdebug', 42);
    expect(sessionConfigFromTree(tree, '/tmp/proj', '/ext/bin/darwin-arm64')).toEqual({
      engine: 'dgdebug',
      seed: 42,
      projectRoot: '/tmp/proj',
      bundledBinDir: '/ext/bin/darwin-arm64'
    });
  });
});

describe('randomSeed', () => {
  it('produces a non-negative integer under 100000, matching dialog-tool\'s (rand-int 100000) fallback', () => {
    for (let i = 0; i < 20; i++) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(100_000);
    }
  });
});

describe('parseSeed', () => {
  it('parses a non-negative integer string', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('0')).toBe(0);
  });

  it('throws a SessionRunnerError for negative numbers, decimals, or non-numeric input', () => {
    expect(() => parseSeed('-1')).toThrow(SessionRunnerError);
    expect(() => parseSeed('1.5')).toThrow(SessionRunnerError);
    expect(() => parseSeed('abc')).toThrow(SessionRunnerError);
    expect(() => parseSeed('')).toThrow(SessionRunnerError);
  });
});

describe('ENGINE_CHOICES', () => {
  it('marks only dgdebug as supported', () => {
    expect(ENGINE_CHOICES.find((c) => c.engine === 'dgdebug')?.supported).toBe(true);
    expect(ENGINE_CHOICES.find((c) => c.engine === 'frotz')?.supported).toBe(false);
    expect(ENGINE_CHOICES.find((c) => c.engine === 'frotz-release')?.supported).toBe(false);
  });
});

describe('debugTerminalShellArgs', () => {
  it('is --quit plus the source files, matching dialog-tool\'s own "dgt debug" command - no --tag-lines/--unit-test/--seed', () => {
    expect(debugTerminalShellArgs(['/proj/src/meta.dg', '/proj/src/orb.dg'])).toEqual([
      '--quit',
      '/proj/src/meta.dg',
      '/proj/src/orb.dg'
    ]);
  });
});

describe('DEFAULT_SESSION_ID', () => {
  it('is "default", matching dialog-tool\'s default.skein convention', () => {
    expect(DEFAULT_SESSION_ID).toBe('default');
  });
});

describe('listSkeinFiles', () => {
  it('returns an empty array for a project directory with no saved sessions', async () => {
    const emptyDir = path.join(__dirname, 'dialoged', 'skein', '__fixtures__', 'project', 'target-filter');
    expect(await listSkeinFiles(emptyDir)).toEqual([]);
  });
});

describe('isDgdebugAvailable', () => {
  it('is false for a binDir that could not possibly contain a real dgdebug binary', async () => {
    expect(await isDgdebugAvailable('/nonexistent/definitely-not-a-real-path')).toBe(false);
  });

  // Only meaningful when dgdebug is actually installed - see dgdebug-integration.spec.ts for
  // the same skip-rather-than-fail convention on machines/CI without the Dialog toolchain.
  const dgdebugOnPath = (() => {
    try {
      require('child_process').execFileSync('dgdebug', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  (dgdebugOnPath ? it : it.skip)('is true when dgdebug is on PATH (no binDir given)', async () => {
    expect(await isDgdebugAvailable(undefined)).toBe(true);
  });

  it('is false when neither binDir nor bundledBinDir could contain a real dgdebug binary', async () => {
    expect(await isDgdebugAvailable(undefined, '/nonexistent/bundled-bin-dir')).toBe(false);
  });

  // Only meaningful once `npm run fetch-dialog-binaries -- --target <this platform-arch>` has
  // staged bin/<platform>-<arch>/dgdebug locally (see scripts/fetch-dialog-binaries.js) - skips
  // rather than fails when absent, same convention as dgdebugOnPath above.
  const bundledBinDir = resolveBundledBinDir(path.join(__dirname, '..'));
  (bundledBinDir ? it : it.skip)(
    'is true when bundledBinDir contains a real dgdebug binary, with no binDir/PATH needed',
    async () => {
      expect(await isDgdebugAvailable(undefined, bundledBinDir)).toBe(true);
    }
  );
});
