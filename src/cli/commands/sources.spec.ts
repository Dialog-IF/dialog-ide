import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listSourcesCommand } from './sources';

const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');
const TARGET_FILTER_ROOT = path.join(
  __dirname, '..', '..', 'dialoged', 'skein', '__fixtures__', 'project', 'target-filter'
);

describe('listSourcesCommand', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints one path per line by default and returns 0', () => {
    const exitCode = listSourcesCommand({ project: FIXTURE_ROOT });

    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(path.join(FIXTURE_ROOT, 'src', 'meta.dg'));
    expect(logSpy).toHaveBeenCalledWith(path.join(FIXTURE_ROOT, 'src', 'orb.dg'));
    // debug not requested, so lib/dialog/debug's stddebug.dg is excluded.
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('stddebug.dg'));
  });

  it('includes debug sources when --debug is given', () => {
    listSourcesCommand({ project: FIXTURE_ROOT, debug: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stddebug.dg'));
  });

  it('prints a colon-joined single line with --single-line', () => {
    listSourcesCommand({ project: FIXTURE_ROOT, singleLine: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0];
    expect(line).toContain(':');
    expect(line.split(':')).toEqual([
      path.join(FIXTURE_ROOT, 'src', 'meta.dg'),
      path.join(FIXTURE_ROOT, 'src', 'orb.dg'),
      path.join(FIXTURE_ROOT, 'lib', 'dialog', 'stdlib.dg')
    ]);
  });

  it('filters by --target suffix, keeping unsuffixed files and only the matching-suffix variant', () => {
    listSourcesCommand({ project: TARGET_FILTER_ROOT, target: 'dgdebug', singleLine: true });

    const [line] = logSpy.mock.calls[0];
    const names = (line as string).split(':').map((p) => path.basename(p));
    expect(names).toEqual(['always.dg', 'sometimes.dgdebug.dg']);
  });

  it('reports "No matching source files" and still returns 0 when nothing matches', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-sources-empty-'));
    fs.writeFileSync(path.join(tempRoot, 'dialog.json'), JSON.stringify({ sources: { main: ['nonexistent'] } }));

    try {
      const exitCode = listSourcesCommand({ project: tempRoot });

      expect(exitCode).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith('No matching source files');
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
