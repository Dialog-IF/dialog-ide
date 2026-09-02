import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('./skein-server', () => ({
  ...jest.requireActual('./skein-server'),
  runInteractiveSkein: jest.fn().mockResolvedValue(0)
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runInteractiveSkein } = require('./skein-server') as { runInteractiveSkein: jest.Mock };
import { openSkeinCommand } from './open-skein';

describe('openSkeinCommand', () => {
  let tempRoot: string;

  beforeEach(() => {
    runInteractiveSkein.mockClear();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-open-skein-'));
    fs.writeFileSync(path.join(tempRoot, 'dialog.json'), JSON.stringify({ sources: { main: [] } }));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('rejects a missing skein file', async () => {
    await expect(openSkeinCommand('missing', { project: tempRoot })).rejects.toThrow('not found');
    expect(runInteractiveSkein).not.toHaveBeenCalled();
  });

  it('rejects a name that looks like a path before touching disk', async () => {
    await expect(openSkeinCommand('../escape', { project: tempRoot })).rejects.toThrow('not a valid skein name');
  });

  it('starts an interactive server in open mode for an existing skein', async () => {
    fs.writeFileSync(path.join(tempRoot, 'default.skein'), 'seed: 1\nengine: dgdebug\n');

    const code = await openSkeinCommand(undefined, { project: tempRoot, theme: 'dark' });

    expect(code).toBe(0);
    expect(runInteractiveSkein).toHaveBeenCalledTimes(1);
    const [params, banner] = runInteractiveSkein.mock.calls[0];
    expect(params).toMatchObject({ sessionId: 'default', mode: 'open', theme: 'dark', port: 0 });
    expect(banner).toContain('Opened default.skein');
  });
});
