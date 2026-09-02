import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parsePortOption, parseThemeOption, resolveSkeinSessionId } from './skein-server';

jest.mock('./skein-server', () => ({
  ...jest.requireActual('./skein-server'),
  runInteractiveSkein: jest.fn().mockResolvedValue(0)
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runInteractiveSkein } = require('./skein-server') as { runInteractiveSkein: jest.Mock };
import { newSkeinCommand, resolveSeedOption } from './new-skein';

describe('parseThemeOption', () => {
  it('defaults to light and accepts light/dark', () => {
    expect(parseThemeOption(undefined)).toBe('light');
    expect(parseThemeOption('light')).toBe('light');
    expect(parseThemeOption('dark')).toBe('dark');
  });

  it('rejects anything else', () => {
    expect(() => parseThemeOption('DARK')).toThrow('not a valid theme');
    expect(() => parseThemeOption('blue')).toThrow('not a valid theme');
  });
});

describe('parsePortOption', () => {
  it('defaults to 0 and accepts a valid port', () => {
    expect(parsePortOption(undefined)).toBe(0);
    expect(parsePortOption('0')).toBe(0);
    expect(parsePortOption('8080')).toBe(8080);
  });

  it('rejects a non-integer or out-of-range port', () => {
    expect(() => parsePortOption('-1')).toThrow('not a valid port');
    expect(() => parsePortOption('70000')).toThrow('not a valid port');
    expect(() => parsePortOption('abc')).toThrow('not a valid port');
  });
});

describe('resolveSkeinSessionId', () => {
  it('defaults to "default" and strips a trailing .skein', () => {
    expect(resolveSkeinSessionId(undefined)).toBe('default');
    expect(resolveSkeinSessionId('combat.skein')).toBe('combat');
    expect(resolveSkeinSessionId('combat')).toBe('combat');
  });

  it('rejects a name that looks like a path', () => {
    expect(() => resolveSkeinSessionId('a/b')).toThrow('not a valid skein name');
    expect(() => resolveSkeinSessionId('..')).toThrow('not a valid skein name');
  });
});

describe('resolveSeedOption', () => {
  it('returns a non-negative integer when omitted', () => {
    const seed = resolveSeedOption(undefined);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('parses a given seed and rejects a bad one', () => {
    expect(resolveSeedOption('42')).toBe(42);
    expect(() => resolveSeedOption('-1')).toThrow();
    expect(() => resolveSeedOption('notanumber')).toThrow();
  });
});

describe('newSkeinCommand', () => {
  let tempRoot: string;

  beforeEach(() => {
    runInteractiveSkein.mockClear();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-new-skein-'));
    fs.writeFileSync(path.join(tempRoot, 'dialog.json'), JSON.stringify({ sources: { main: [] } }));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('starts an interactive server for a fresh skein, passing the parsed options through', async () => {
    const code = await newSkeinCommand('combat', { project: tempRoot, seed: '7', theme: 'dark', port: '5599' });

    expect(code).toBe(0);
    expect(runInteractiveSkein).toHaveBeenCalledTimes(1);
    const [params, banner] = runInteractiveSkein.mock.calls[0];
    expect(params).toMatchObject({ sessionId: 'combat', mode: 'new', seed: 7, theme: 'dark', port: 5599 });
    expect(banner).toContain('Created combat.skein');
  });

  it('refuses to overwrite an existing .skein', async () => {
    fs.writeFileSync(path.join(tempRoot, 'default.skein'), 'seed: 1\nengine: dgdebug\n');

    await expect(newSkeinCommand(undefined, { project: tempRoot })).rejects.toThrow('already exists');
    expect(runInteractiveSkein).not.toHaveBeenCalled();
  });
});
