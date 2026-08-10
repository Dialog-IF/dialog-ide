import { EventEmitter } from 'events';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args)
}));

import { SkeinProcess, ProcessConfig } from './process';

/**
 * A fake ChildProcess: EventEmitter for process-level events ('close', 'error'), plus
 * EventEmitter stdout/stderr streams and a spied stdin.write, matching just enough of the
 * child_process.ChildProcess shape that process.ts actually touches.
 */
function createFakeChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: jest.Mock };
    kill: jest.Mock;
    exitCode: number | null;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: jest.fn() };
  child.kill = jest.fn();
  child.exitCode = null;
  return child;
}

/**
 * Builds a synthetic tagged raw buffer the way dgdebug (--tag-lines) actually emits one -
 * see io.spec.ts for the same helper against IoDetector directly. Accurate for the very first
 * response of a session (the startup banner), where there's no prior prompt to have seeded the
 * buffer - see echoedResponseBuffer for any response after that.
 */
function taggedBuffer(contentLines: string[], promptLine: string): string {
  const tagged = contentLines.map((line) => `  ${line}`);
  return [...tagged, promptLine].join('\n');
}

/**
 * Builds the raw stdout chunk dgdebug emits for a command *after* the first one in a session.
 * Unlike the first response, this doesn't start with its own 2-char tag - the previous prompt's
 * tag (already reseeded into SkeinProcess's buffer by nextBufferSeed) covers the command echo
 * too, so the echo appears bare here, exactly as dgdebug's real raw stream does.
 */
function echoedResponseBuffer(command: string, contentLines: string[], promptLine: string): string {
  return `${command}\n${taggedBuffer(contentLines, promptLine)}`;
}

const DGDEBUG_CONFIG: ProcessConfig = {
  engine: 'dgdebug',
  seed: 1,
  sourceFiles: ['/tmp/proj/src/meta.dg', '/tmp/proj/src/orb.dg']
};

describe('SkeinProcess', () => {
  let fakeChild: ReturnType<typeof createFakeChildProcess>;

  beforeEach(() => {
    mockSpawn.mockReset();
    fakeChild = createFakeChildProcess();
    mockSpawn.mockReturnValue(fakeChild);
  });

  describe('start', () => {
    it('spawns dgdebug with the documented flags and the given source files as positional args', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();

      expect(mockSpawn).toHaveBeenCalledWith(
        'dgdebug',
        [
          '--numbered',
          '--seed', '1',
          '--width', '-1',
          '--unit-test',
          '--transcripting',
          '--tag-lines',
          '--formatting', 'ansi',
          '/tmp/proj/src/meta.dg',
          '/tmp/proj/src/orb.dg'
        ],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
      expect(proc.isProcessRunning()).toBe(true);
    });

    it('inserts debugFlags between the standard flags and the source files', async () => {
      const proc = new SkeinProcess({ ...DGDEBUG_CONFIG, debugFlags: ['--trace'] });
      await proc.start();

      expect(mockSpawn).toHaveBeenCalledWith(
        'dgdebug',
        expect.arrayContaining(['--trace', '/tmp/proj/src/meta.dg']),
        expect.anything()
      );
    });

    it('resolves the dgdebug binary from binDir when given', async () => {
      const proc = new SkeinProcess({ ...DGDEBUG_CONFIG, binDir: '/opt/dialog/bin' });
      await proc.start();

      expect(mockSpawn).toHaveBeenCalledWith('/opt/dialog/bin/dgdebug', expect.anything(), expect.anything());
    });

    it('throws if dgdebug is started without sourceFiles', async () => {
      const proc = new SkeinProcess({ engine: 'dgdebug', seed: 1 });
      await expect(proc.start()).rejects.toThrow('dgdebug requires sourceFiles');
    });

    it('spawns dfrotz with the documented flags for both frotz and frotz-release', async () => {
      const proc = new SkeinProcess({ engine: 'frotz-release', seed: 42, gamePath: '/tmp/g.zblorb' });
      await proc.start();

      expect(mockSpawn).toHaveBeenCalledWith(
        'dfrotz',
        ['-q', '-m', '-r', 'lt', '-f', 'normal', '-s', '42', '-w', '-1', '/tmp/g.zblorb'],
        expect.anything()
      );
    });

    it('throws if frotz is started without gamePath', async () => {
      const proc = new SkeinProcess({ engine: 'frotz', seed: 1 });
      await expect(proc.start()).rejects.toThrow('frotz requires gamePath');
    });
  });

  describe('readResponse', () => {
    it('resolves once the accumulated stdout buffer reaches the line-prompt terminator', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();
      proc.sendCommand('look');

      const readPromise = proc.readResponse();
      fakeChild.stdout.emit('data', Buffer.from(taggedBuffer(['You are here.'], '> ')));

      await expect(readPromise).resolves.toEqual({
        command: 'look',
        response: 'You are here.\n',
        promptType: 'line'
      });
    });

    it('does not resolve until the terminator arrives, even across chunked stdout events', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();
      proc.sendCommand('look');

      const readPromise = proc.readResponse();
      let resolved = false;
      readPromise.then(() => {
        resolved = true;
      });

      fakeChild.stdout.emit('data', Buffer.from('  You are '));
      await Promise.resolve();
      expect(resolved).toBe(false);

      fakeChild.stdout.emit('data', Buffer.from('here.\n> '));
      const response = await readPromise;
      expect(response.response).toBe('You are here.\n');
    });

    it('reports promptType "key" for a keystroke prompt', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();
      proc.sendCommand('score');

      const readPromise = proc.readResponse();
      fakeChild.stdout.emit('data', Buffer.from(taggedBuffer(['Press a key.'], ') ')));

      const response = await readPromise;
      expect(response.promptType).toBe('key');
    });

    it('delivers a response that completed before readResponse() was called, from the queue', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();
      proc.sendCommand('look');

      fakeChild.stdout.emit('data', Buffer.from(taggedBuffer(['You are here.'], '> ')));

      const response = await proc.readResponse();
      expect(response.response).toBe('You are here.\n');
    });

    it('reseeds the buffer with the prior prompt between responses, so a second command gets only its own output plus its echoed "> command" prefix', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();

      proc.sendCommand('look');
      const first = proc.readResponse();
      fakeChild.stdout.emit('data', Buffer.from(taggedBuffer(['You are here.'], '> ')));
      await first;

      proc.sendCommand('inventory');
      const second = proc.readResponse();
      fakeChild.stdout.emit('data', Buffer.from(echoedResponseBuffer('inventory', ['You are carrying nothing.'], '> ')));

      await expect(second).resolves.toEqual({
        command: 'inventory',
        response: '> inventory\nYou are carrying nothing.\n',
        promptType: 'line'
      });
    });

    it('does not truncate a multi-character command\'s echo (regression: the buffer must be reseeded with the prior prompt\'s tag, not reset to empty, or the echo\'s first two characters are lost to a stray tag-strip)', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();

      proc.sendCommand('look');
      const first = proc.readResponse();
      fakeChild.stdout.emit('data', Buffer.from(taggedBuffer(['A room.'], '> ')));
      await first;

      proc.sendCommand('take orb');
      const second = proc.readResponse();
      fakeChild.stdout.emit('data', Buffer.from(echoedResponseBuffer('take orb', ['You take the orb.'], '> ')));

      await expect(second).resolves.toEqual({
        command: 'take orb',
        response: '> take orb\nYou take the orb.\n',
        promptType: 'line'
      });
    });

    it('rejects if the process is not running and nothing is queued', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await expect(proc.readResponse()).rejects.toThrow('Process not running');
    });

    it('rejects any still-pending reader when the process closes early', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();
      proc.sendCommand('look');

      const readPromise = proc.readResponse();
      fakeChild.emit('close', 1, null);

      await expect(readPromise).rejects.toThrow('Process closed before a response was received');
    });

    it('flushes a partial trailing buffer as a best-effort response when the process closes mid-response', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();
      proc.sendCommand('look');

      const readPromise = proc.readResponse();
      fakeChild.stdout.emit('data', Buffer.from('  Incomplete output with no prompt yet'));
      fakeChild.emit('close', 1, null);

      const response = await readPromise;
      expect(response.response).toBe('Incomplete output with no prompt yet\n');
    });
  });

  describe('sendCommand', () => {
    it('writes the command plus a newline to stdin', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();

      proc.sendCommand('look');

      expect(fakeChild.stdin.write).toHaveBeenCalledWith('look\n');
    });

    it('throws if the process has not been started', () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      expect(() => proc.sendCommand('look')).toThrow('Process not running');
    });
  });

  describe('terminate', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('sends SIGTERM and resolves as soon as the process closes, without waiting out the full timeout', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();

      const terminated = proc.terminate();
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
      fakeChild.exitCode = 0;
      fakeChild.emit('close', 0, null);
      await terminated;

      expect(fakeChild.kill).not.toHaveBeenCalledWith('SIGKILL');
      expect(proc.isProcessRunning()).toBe(false);
    });

    it('force-kills and resolves once the timeout elapses if the process never closes on its own', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await proc.start();

      const terminated = proc.terminate();
      await jest.advanceTimersByTimeAsync(1000);
      await terminated;

      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('is a no-op when the process was never started', async () => {
      const proc = new SkeinProcess(DGDEBUG_CONFIG);
      await expect(proc.terminate()).resolves.toBeUndefined();
      expect(fakeChild.kill).not.toHaveBeenCalled();
    });
  });
});
