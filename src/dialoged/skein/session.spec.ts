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
import { SkeinTree } from './tree';

const BANNER_RESPONSE = { command: '', response: 'Welcome to the game.\n', promptType: 'line' as const };

async function startedSessionWith(tree: SkeinTree): Promise<SkeinSession> {
  mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
  const session = SkeinSession.createLoaded(tree, DGDEBUG_CONFIG);
  await session.start();
  return session;
}

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
    it('reads the project, expands sources, and captures the interpreter\'s initial response', async () => {
      mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);

      await session.start();

      expect(mockReadResponse).toHaveBeenCalledTimes(1);
      expect(session.isRunningSession()).toBe(true);
    });

    it('replaces knot 0\'s placeholder text with the real, blessed startup banner', async () => {
      mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);

      await session.start();

      const knot0 = session.getTree().getDerivedKnot(0)!;
      expect(knot0.response).toBe('Welcome to the game.\n');
      expect(knot0.unblessedResponse).toBeNull();
      expect(knot0.state).toBe('valid');
    });

    it('emits a change event once the startup banner is captured', async () => {
      mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      const onChange = jest.fn();
      session.onChange(onChange);

      await session.start();

      expect(onChange).toHaveBeenCalledTimes(1);
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

    // Reuse only matters when the active knot already has a child for the command about to run -
    // not naturally reachable via runCommand alone yet (each call advances the active knot, and
    // there's no click-navigation back to an earlier knot yet), so these seed a loaded tree that
    // already has the child in place, via createLoaded, rather than driving it through runCommand.
    it('reuses the existing child knot when the same command is run again from the same parent, rather than duplicating it', async () => {
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .setActiveKnotId(0);
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');

      const tree = session.getTree();
      expect(tree.getActiveKnotId()).toBe(1);
      expect(tree.getAllKnots()).toHaveLength(2); // root + the one reused knot, not a new one
    });

    it('updates the reused knot\'s response text when the re-run command produces different output', async () => {
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .setActiveKnotId(0);
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A, but darker now.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');

      // updateKnotResponse only ever sets the *unblessed* text (see tree.spec.ts for the full
      // blessed/unblessed status semantics) - this just confirms reuse actually flows the new
      // response through, rather than leaving the reused knot's content stale.
      const knot1 = session.getTree().getDerivedKnot(1)!;
      expect(knot1.unblessedResponse).toBe('Room A, but darker now.\n');
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

    it('does not restart the process when the active knot already matches where the process is', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');

      expect(mockTerminate).not.toHaveBeenCalled();
    });

    it('replays the path to the active knot first when it no longer matches where the process is - e.g. after loading a skein or jumping around the tree and adding a new command from an earlier knot (normal, everyday use, not an error)', async () => {
      // A loaded tree whose active knot is already knot 1 ("look") - the freshly-spawned process
      // is only ever at knot 0 (the banner), regardless of what the loaded tree says, so the very
      // first command has to replay "look" before "north" can be sent.
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .setActiveKnotId(1);
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE) // session.start()
        .mockResolvedValueOnce(BANNER_RESPONSE) // replay's relaunch
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' }) // replayed step
        .mockResolvedValueOnce(dynamicResponse([])) // replayTo's own @dynamic
        .mockResolvedValueOnce({ command: 'north', response: 'Room B.\n', promptType: 'line' }) // the actual new command
        .mockResolvedValueOnce(dynamicResponse([])); // runCommand's @dynamic
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('north');

      expect(mockTerminate).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledTimes(2); // session.start() + the replay relaunch
      expect(mockSendCommand.mock.calls.map((call) => call[0])).toEqual(['look', '@dynamic', 'north', '@dynamic']);
      const tree = session.getTree();
      expect(tree.getKnot(2)!.parentId).toBe(1);
      expect(tree.getActiveKnotId()).toBe(2);
    });
  });

  describe('replayAll / replayToKnot', () => {
    it('restarts the process, resends the active spine, and re-validates each response', async () => {
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .blessKnot(1)
        .setActiveKnotId(1);
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE) // session.start()
        .mockResolvedValueOnce(BANNER_RESPONSE) // replay's relaunch
        .mockResolvedValueOnce({ command: 'look', response: 'Room A, but dustier now.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.replayAll();

      expect(mockTerminate).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'look');
      const knot1 = session.getTree().getDerivedKnot(1)!;
      expect(knot1.unblessedResponse).toBe('Room A, but dustier now.\n');
      expect(knot1.state).toBe('error'); // differs from the blessed 'Room A.\n'
    });

    it('replayToKnot targets a specific knot and makes it the active one', async () => {
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .addChild(0, 'inventory', { text: 'Empty-handed.\n', inputType: 'line' })
        .setActiveKnotId(2);
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.replayToKnot(1);

      expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'look');
      expect(session.getTree().getActiveKnotId()).toBe(1);
    });
  });

  describe('setActiveKnot', () => {
    it('changes the active knot without touching the process', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.setActiveKnot(1);

      expect(session.getTree().getActiveKnotId()).toBe(1);
      expect(mockTerminate).not.toHaveBeenCalled();
      // Navigating alone must never move the process position - only an explicit replay does.
      expect(session.getProcessPositionId()).toBe(0);
    });

    it('emits a change event', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      const onChange = jest.fn();
      session.onChange(onChange);

      session.setActiveKnot(1);

      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('throws for an unknown knot id', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.setActiveKnot(999)).toThrow();
    });

    it('closes both panes\' menus - navigating away means the user is done with them', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      );
      session.openGraphMenu(1);
      session.openTranscriptMenu(1);

      session.setActiveKnot(2);

      expect(session.getGraphMenuId()).toBeNull();
      expect(session.getTranscriptMenuId()).toBeNull();
    });
  });

  describe('openGraphMenu / openTranscriptMenu', () => {
    it('are tracked independently - opening one pane\'s menu never opens the other\'s', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.openGraphMenu(1);

      expect(session.getGraphMenuId()).toBe(1);
      expect(session.getTranscriptMenuId()).toBeNull();
    });

    it('opening the transcript menu on a different knot closes the graph menu, not the other way around', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      );
      session.openGraphMenu(1);

      session.openTranscriptMenu(2);

      expect(session.getGraphMenuId()).toBeNull();
      expect(session.getTranscriptMenuId()).toBe(2);
    });

    it('neither changes the active knot - opening a menu (right-click or the trigger) and navigating are independent; only setActiveKnot (a plain left-click) does that', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .setActiveKnotId(0)
      );

      session.openGraphMenu(1);
      expect(session.getTree().getActiveKnotId()).toBe(0);

      session.openTranscriptMenu(1);
      expect(session.getTree().getActiveKnotId()).toBe(0);
    });

    it('throw for an unknown knot id', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.openGraphMenu(999)).toThrow();
      expect(() => session.openTranscriptMenu(999)).toThrow();
    });
  });

  describe('menus close after any mutating action', () => {
    it('bless/toggle-lock/set-label/delete/splice each close both open menus', async () => {
      const scenarios: Array<[string, (s: SkeinSession) => void]> = [
        ['blessKnot', (s) => s.blessKnot(1)],
        ['blessChanges', (s) => s.blessChanges(1)],
        ['toggleLock', (s) => s.toggleLock(1)],
        ['setLabel', (s) => s.setLabel(1, 'x')],
        ['deleteKnot', (s) => s.deleteKnot(1)],
        ['spliceKnot', (s) => s.spliceKnot(1)]
      ];

      for (const [name, act] of scenarios) {
        const session = await startedSessionWith(
          SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
        );
        session.openGraphMenu(1);
        session.openTranscriptMenu(1);

        act(session);

        expect(session.getGraphMenuId()).toBeNull();
        expect(session.getTranscriptMenuId()).toBeNull();
      }
    });
  });

  describe('closeAllMenus', () => {
    it('closes both menus', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      session.openGraphMenu(1);
      session.openTranscriptMenu(1);

      session.closeAllMenus();

      expect(session.getGraphMenuId()).toBeNull();
      expect(session.getTranscriptMenuId()).toBeNull();
    });

    it('emits a change event when something was actually open', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      session.openGraphMenu(1);
      const onChange = jest.fn();
      session.onChange(onChange);

      session.closeAllMenus();

      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('is a no-op (no emit) when nothing was open - clicking blank space costs nothing', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      const onChange = jest.fn();
      session.onChange(onChange);

      session.closeAllMenus();

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('blessKnot / blessChanges', () => {
    it('blesses a single knot', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.blessKnot(1);

      expect(session.getTree().getDerivedKnot(1)!.state).toBe('valid');
    });

    it('blesses every unblessed knot along the path to id', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(1, 'north', { text: 'b', inputType: 'line' })
      );

      session.blessChanges(2);

      expect(session.getTree().getDerivedKnot(1)!.state).toBe('valid');
      expect(session.getTree().getDerivedKnot(2)!.state).toBe('valid');
    });
  });

  describe('toggleLock', () => {
    it('flips the lock status', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.toggleLock(1);
      expect(session.getTree().getKnot(1)!.locked).toBe(true);

      session.toggleLock(1);
      expect(session.getTree().getKnot(1)!.locked).toBe(false);
    });

    it('throws for the root knot', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.toggleLock(0)).toThrow();
    });
  });

  describe('setLabel', () => {
    it('sets a label on a knot', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.setLabel(1, 'checkpoint');

      expect(session.getTree().getKnot(1)!.label).toBe('checkpoint');
    });

    it('throws for the root knot', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.setLabel(0, 'nope')).toThrow();
    });
  });

  describe('deleteKnot', () => {
    it('removes the knot and its descendants, leaving an unrelated active knot alone', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
          .setActiveKnotId(1)
      );

      session.deleteKnot(2);

      expect(session.getTree().getKnot(2)).toBeNull();
      expect(session.getTree().getActiveKnotId()).toBe(1);
    });

    it("reassigns the active knot to the parent when the active knot itself is deleted", async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).setActiveKnotId(1)
      );

      session.deleteKnot(1);

      expect(session.getTree().getKnot(1)).toBeNull();
      expect(session.getTree().getActiveKnotId()).toBe(0);
    });

    it('reassigns the active knot to the parent when the active knot is a descendant of the deleted knot', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(1, 'north', { text: 'b', inputType: 'line' })
          .setActiveKnotId(2)
      );

      session.deleteKnot(1);

      expect(session.getTree().getKnot(1)).toBeNull();
      expect(session.getTree().getKnot(2)).toBeNull();
      expect(session.getTree().getActiveKnotId()).toBe(0);
    });

    it('throws for the root knot', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.deleteKnot(0)).toThrow();
    });
  });

  describe('spliceKnot', () => {
    it('removes the knot and reparents its children', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(1, 'north', { text: 'b', inputType: 'line' })
      );

      session.spliceKnot(1);

      expect(session.getTree().getKnot(1)).toBeNull();
      expect(session.getTree().getKnot(2)!.parentId).toBe(0);
    });

    it('reassigns the active knot to the parent when the active knot is exactly the spliced knot', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(1, 'north', { text: 'b', inputType: 'line' })
          .setActiveKnotId(1)
      );

      session.spliceKnot(1);

      expect(session.getTree().getActiveKnotId()).toBe(0);
    });

    it('leaves the active knot alone when it is a (reparented, still-existing) descendant of the spliced knot', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(1, 'north', { text: 'b', inputType: 'line' })
          .setActiveKnotId(2)
      );

      session.spliceKnot(1);

      expect(session.getTree().getActiveKnotId()).toBe(2);
      expect(session.getTree().getKnot(2)!.parentId).toBe(0);
    });

    it('throws for the root knot', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.spliceKnot(0)).toThrow();
    });
  });
});
