import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExportConfig } from '../../dialoged/skein';
import { bundleCommand, resolveExportConfig } from './bundle';

function config(name: string, format: ExportConfig['format'] = 'zblorb'): ExportConfig {
  return { name, format, includeDebug: false, output: `out/${name}.${format}` };
}

describe('resolveExportConfig', () => {
  it('returns the sole configuration when no name is given and exactly one is defined', () => {
    const only = config('Release');
    expect(resolveExportConfig([only], undefined)).toBe(only);
  });

  it('returns the named configuration by exact name match', () => {
    const web = config('Web', 'aa');
    expect(resolveExportConfig([config('Release'), web], 'Web')).toBe(web);
  });

  it('throws listing every defined name when no name is given but several exist', () => {
    expect(() => resolveExportConfig([config('Release'), config('Web', 'aa')], undefined)).toThrow(
      'Release, Web'
    );
  });

  it('throws listing every defined name when the given name matches none', () => {
    expect(() => resolveExportConfig([config('Release'), config('Web', 'aa')], 'Nope')).toThrow(
      'No export configuration named "Nope"'
    );
  });

  it('throws a "add one under exports" hint when none are defined at all', () => {
    expect(() => resolveExportConfig([], undefined)).toThrow('No export configurations defined');
    expect(() => resolveExportConfig([], 'Whatever')).toThrow('No export configurations defined');
  });
});

describe('bundleCommand validation', () => {
  it('rejects when the project directory has no dialog.json at all', async () => {
    const noProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-bundle-noproj-'));
    try {
      await expect(bundleCommand(undefined, { project: noProjectDir })).rejects.toThrow('does not exist');
    } finally {
      fs.rmSync(noProjectDir, { recursive: true, force: true });
    }
  });

  it('rejects before any toolchain lookup when dialog.json defines no exports', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-bundle-noexports-'));
    fs.writeFileSync(path.join(tempRoot, 'dialog.json'), JSON.stringify({ sources: { main: [] } }));
    try {
      await expect(bundleCommand(undefined, { project: tempRoot })).rejects.toThrow(
        'No export configurations defined'
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
