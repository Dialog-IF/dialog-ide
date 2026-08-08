const mockStart = jest.fn();
const mockSendCommand = jest.fn();
const mockReadResponse = jest.fn();
const mockTerminate = jest.fn();

jest.mock('./process', () => ({
  SkeinProcess: jest.fn().mockImplementation(() => ({
    start: mockStart,
    sendCommand: mockSendCommand,
    readResponse: mockReadResponse,
    terminate: mockTerminate,
    isProcessRunning: jest.fn().mockReturnValue(true)
  }))
}));

import * as path from 'path';
import { SkeinSession, SessionConfig } from './session';

const BANNER_RESPONSE = { command: '', response: 'Welcome to the game.\n', promptType: 'line' as const };

function dynamicResponse(flagLines: string[]) {
  return {
    command: '@dynamic',
    response: ['> @dynamic', 'GLOBAL FLAGS', ...flagLines, '', 'PER-OBJECT FLAGS', '', 'GLOBAL VARIABLES', '', 'PER-OBJECT VARIABLES', ''].join('\n'),
    promptType: 'line' as const
  };
}

// A real fixture project (see project.spec.ts) - session.start() actually reads dialog.json and
// expands its sources for real here, only the process I/O itself is mocked.
const DGSAMPLE_ROOT = path.join(__dirname, '__fixtures__', 'project', 'dgsample');
const DGDEBUG_CONFIG: SessionConfig = { engine: 'dgdebug', seed: 1, projectRoot: DGSAMPLE_ROOT };
const FROTZ_CONFIG: SessionConfig = { engine: 'frotz', seed: 1, projectRoot: DGSAMPLE_ROOT };

describe('SkeinSession', () => {
  beforeEach(() => {
    mockStart.mockReset().mockResolvedValue(undefined);
    mockSendCommand.mockReset();
    mockReadResponse.mockReset();
    mockTerminate.mockReset().mockResolvedValue(undefined);
  });

  describe('start', () => {
    it('reads the project, expands sources, and drains the interpreter\'s initial response', async () => {
      mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);

      await session.start();

      expect(mockReadResponse).toHaveBeenCalledTimes(1);
      expect(session.isRunningSession()).toBe(true);
    });

    it('throws for engines that need a compiled game (frotz/frotz-release), which isn\'t implemented yet', async () => {
      const session = SkeinSession.createNew(FROTZ_CONFIG);
      await expect(session.start()).rejects.toThrow('frotz is not yet supported');
      expect(session.isRunningSession()).toBe(false);
    });
  });

  describe('runCommand', () => {
    it('parents the first command under the root knot (the initial active knot)', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');

      const tree = session.getTree();
      expect(tree.getActiveKnotId()).toBe(1);
      expect(tree.getKnot(1)!.parentId).toBe(0);
    });

    it('parents each subsequent command under the current active knot, not hardcoded to root', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]))
        .mockResolvedValueOnce({ command: 'north', response: 'Room B.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');
      await session.runCommand('north');

      const tree = session.getTree();
      expect(tree.getActiveKnotId()).toBe(2);
      expect(tree.getKnot(2)!.parentId).toBe(1);
    });

    it('queries @dynamic after each command for dgdebug and exposes the parsed state', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse(['  (game started) on']));
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');

      expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'look');
      expect(mockSendCommand).toHaveBeenNthCalledWith(2, '@dynamic');
      expect(session.getDynamicState()!.flags.has('(game started)')).toBe(true);
      expect(session.getDynamicChanges()).toBeNull();
    });

    it('diffs dynamic state against the previous snapshot on the next command', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse(['  (game started) on']))
        .mockResolvedValueOnce({ command: 'light torch', response: 'It flickers to life.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse(['  (game started) on', '  (torch lit) on']));
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');
      await session.runCommand('light torch');

      expect(session.getDynamicChanges()!.added).toEqual(new Set(['(torch lit)']));
    });

    it('throws if the session has not been started', async () => {
      const session = SkeinSession.createNew(FROTZ_CONFIG);
      await expect(session.runCommand('look')).rejects.toThrow('Session not running');
    });
  });
});
