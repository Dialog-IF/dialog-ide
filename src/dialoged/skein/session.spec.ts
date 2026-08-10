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
import { LabelConflictError, SkeinTree } from './tree';
import { ProgressHost } from './progress';

/**
 * A controllable ProgressHost double for replayAll's progress/cancellation tests - runs the task
 * synchronously (like noopProgressHost), but records every withProgress() call's options and
 * every progress.report() update, and lets a test flip the token's isCancellationRequested
 * partway through by passing cancelAfterReports.
 */
function fakeProgressHost(cancelAfterReports?: number) {
  const withProgressCalls: { title: string; cancellable: boolean }[] = [];
  const reports: { message?: string; increment?: number }[] = [];
  const host: ProgressHost = {
    async withProgress(options, task) {
      withProgressCalls.push(options);
      const token = { isCancellationRequested: false };
      const progress = {
        report: (update: { message?: string; increment?: number }) => {
          reports.push(update);
          if (cancelAfterReports !== undefined && reports.length >= cancelAfterReports) {
            token.isCancellationRequested = true;
          }
        }
      };
      return task(progress, token);
    }
  };
  return { host, withProgressCalls, reports };
}

const BANNER_RESPONSE = { command: '', response: 'Welcome to the game.\n', promptType: 'line' as const };

async function startedSessionWith(tree: SkeinTree): Promise<SkeinSession> {
  mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
  const session = SkeinSession.createLoaded(tree, DGDEBUG_CONFIG);
  await session.start();
  // createLoaded sessions diff the live banner against knot 0's already-loaded response rather
  // than auto-blessing it (see session.ts) - every tree built via SkeinTree.newTree(...) here
  // still carries its synthetic placeholder text there, which never matches BANNER_RESPONSE, so
  // without this every single test using this helper would start with a spuriously 'error' root.
  // Resolve that here since it's not what these tests are about; the dedicated 'loaded session
  // root revalidation' tests below cover the real behavior directly.
  session.blessKnot(0);
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

    describe('loaded session root revalidation', () => {
      // createLoaded's tree carries a real, previously-blessed knot 0 (loaded from a .skein
      // file) - unlike createNew's synthetic placeholder, that's genuine history the live
      // banner should be diffed against, not silently overwritten. Regression coverage for: a
      // manually-edited-and-reloaded .skein file's knot 0 changes never showing up as a change.
      it('flags knot 0 as changed when the live banner no longer matches the loaded response, instead of silently re-blessing it', async () => {
        mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
        const loaded = SkeinTree.newTree('dgdebug', 1).blessKnot(0); // no-op: newTree's root starts blessed
        const session = SkeinSession.createLoaded(loaded, DGDEBUG_CONFIG);

        await session.start();

        const knot0 = session.getTree().getDerivedKnot(0)!;
        expect(knot0.state).toBe('error');
        expect(knot0.response).toBe('Welcome to the game. > '); // the loaded text, untouched
        expect(knot0.unblessedResponse).toBe('Welcome to the game.\n'); // the live banner, pending
      });

      it('leaves knot 0 valid when the live banner matches the loaded response', async () => {
        mockReadResponse.mockResolvedValueOnce({ command: '', response: 'Welcome to the game. > ', promptType: 'line' as const });
        const session = SkeinSession.createLoaded(SkeinTree.newTree('dgdebug', 1), DGDEBUG_CONFIG);

        await session.start();

        expect(session.getTree().getDerivedKnot(0)!.state).toBe('valid');
      });
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

    // Regression: replayAll used to target getActiveKnotId(), which stops short the moment the
    // user navigates back to an ancestor (see tree.ts's selectKnot/getSelectedLeafId) - the
    // transcript keeps showing everything past it regardless, so "Replay All" silently replayed
    // less than what was actually visible.
    it('replays all the way to the selected spine\'s leaf, not just the active knot, once navigation has moved the active knot back up the tree', async () => {
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .addChild(1, 'take orb', { text: 'Got it.\n', inputType: 'line' })
        .selectKnot(1); // active knot moves back up; knot 2 is still shown in the transcript
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE) // session.start()
        .mockResolvedValueOnce(BANNER_RESPONSE) // replay's relaunch
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce({ command: 'take orb', response: 'Got it.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.replayAll();

      expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'look');
      expect(mockSendCommand).toHaveBeenNthCalledWith(2, 'take orb');
      expect(session.getTree().getActiveKnotId()).toBe(2);
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

    it('re-validates knot 0 against its already-blessed response too, instead of force-blessing it every replay', async () => {
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .blessKnot(1)
        .setActiveKnotId(1);
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE) // session.start()
        .mockResolvedValueOnce({ command: '', response: 'Welcome to the game, changed.\n', promptType: 'line' }) // replay's relaunch: a changed banner
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.replayAll();

      const knot0 = session.getTree().getDerivedKnot(0)!;
      expect(knot0.unblessedResponse).toBe('Welcome to the game, changed.\n');
      expect(knot0.state).toBe('error'); // differs from the blessed 'Welcome to the game. > '
    });
  });

  describe('replayAll progress/cancellation', () => {
    function seededTwoStepTree() {
      return SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .addChild(1, 'take orb', { text: 'Got it.\n', inputType: 'line' })
        .setActiveKnotId(2);
    }

    it('reports each replayed command through the injected progress host, as a cancellable notification', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE) // session.start()
        .mockResolvedValueOnce(BANNER_RESPONSE) // replay's relaunch
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce({ command: 'take orb', response: 'Got it.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const { host, withProgressCalls, reports } = fakeProgressHost();
      const session = SkeinSession.createLoaded(seededTwoStepTree(), DGDEBUG_CONFIG, host);
      await session.start();

      await session.replayAll();

      expect(withProgressCalls).toEqual([{ title: 'Replaying all paths...', cancellable: true }]);
      expect(reports).toEqual([
        { message: 'look', increment: 50 },
        { message: 'take orb', increment: 50 }
      ]);
    });

    it('stops replaying and lands the active knot on the last completed step once the token cancels mid-replay', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE) // session.start()
        .mockResolvedValueOnce(BANNER_RESPONSE) // replay's relaunch
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const { host } = fakeProgressHost(1); // cancel right after the first command's progress is reported
      const session = SkeinSession.createLoaded(seededTwoStepTree(), DGDEBUG_CONFIG, host);
      await session.start();

      await session.replayAll();

      // refreshDynamicState still runs once the (truncated) loop exits, sending its own '@dynamic'
      // command - so 'look' plus that, but never 'take orb'.
      expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'look');
      expect(mockSendCommand).not.toHaveBeenCalledWith('take orb');
      expect(session.getTree().getActiveKnotId()).toBe(1); // not 2, the original target
    });
  });

  describe('replayAll across a forked tree', () => {
    it('replays every leaf, not just the active spine, and restores the active spine afterwards', async () => {
      // root -(look)-> 1 -(take orb)-> 2
      //                 \-(inventory)-> 3
      // addChild always makes the newest child selected, so building 3 after 2 leaves 3 as the
      // tree's "first" spine on load - selectKnot(2) below moves the active spine back onto 2,
      // which replayAll must still land back on once both leaves have been replayed.
      const seeded = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
        .addChild(1, 'take orb', { text: 'Got it.\n', inputType: 'line' })
        .addChild(1, 'inventory', { text: 'Empty-handed.\n', inputType: 'line' })
        .blessKnot(3)
        .selectKnot(2);
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE) // session.start()
        // leaf 3 ('inventory') is replayed first - it isn't the active spine, so it goes first.
        .mockResolvedValueOnce(BANNER_RESPONSE) // relaunch
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce({ command: 'inventory', response: 'Empty-handed.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]))
        // leaf 2 ('take orb') is replayed last, since it's the originally-active spine.
        .mockResolvedValueOnce(BANNER_RESPONSE) // relaunch
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce({ command: 'take orb', response: 'Got it.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createLoaded(seeded, DGDEBUG_CONFIG);
      await session.start();

      await session.replayAll();

      expect(mockTerminate).toHaveBeenCalledTimes(2); // one restart per leaf
      expect(mockSendCommand.mock.calls.map((call) => call[0])).toEqual([
        'look', 'inventory', '@dynamic',
        'look', 'take orb', '@dynamic'
      ]);
      const tree = session.getTree();
      expect(tree.getDerivedKnot(3)!.state).toBe('valid'); // the non-active branch got re-validated too
      expect(tree.getActiveKnotId()).toBe(2); // active spine restored, not left on leaf 3
      expect(tree.getSelectedLeafId()).toBe(2);
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

  describe('newChild', () => {
    it('activates the knot without touching the process, same as setActiveKnot', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.newChild(1);

      expect(session.getTree().getActiveKnotId()).toBe(1);
      expect(mockTerminate).not.toHaveBeenCalled();
      expect(session.getProcessPositionId()).toBe(0);
    });

    // The behavior distinguishing this from setActiveKnot: see tree.spec.ts's
    // SkeinTree.selectForNewChild tests for the full rationale.
    it("clears the knot's own selectedChild, unlike setActiveKnot", async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
          .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // knot 2, knot 1's only child
      );

      session.newChild(1);

      expect(session.getTree().getDerivedKnot(1)!.selectedChild).toBeNull();
    });

    it('emits a change event', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      const onChange = jest.fn();
      session.onChange(onChange);

      session.newChild(1);

      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('throws for an unknown knot id', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.newChild(999)).toThrow();
    });

    it("closes both panes' menus", async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      session.openGraphMenu(1);
      session.openTranscriptMenu(1);

      session.newChild(1);

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

    it('is a real toggle - calling it again for the already-open knot closes it', async () => {
      // Load-bearing, not just nicer UX: the client re-posts to this route every time the
      // trigger is clicked, including to close its own menu. If a second call for the same id
      // didn't actually change state, the re-rendered markup would be identical to what's
      // already on screen and the popover's open/close effect would never re-fire client-side.
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.openGraphMenu(1);
      expect(session.getGraphMenuId()).toBe(1);
      session.openGraphMenu(1);
      expect(session.getGraphMenuId()).toBeNull();

      session.openTranscriptMenu(1);
      expect(session.getTranscriptMenuId()).toBe(1);
      session.openTranscriptMenu(1);
      expect(session.getTranscriptMenuId()).toBeNull();
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

  describe('toggleTreeNode', () => {
    it('flips DerivedKnot.collapsed on alternating calls', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.toggleTreeNode(1);
      expect(session.getTree().getDerivedKnot(1)!.collapsed).toBe(true);

      session.toggleTreeNode(1);
      expect(session.getTree().getDerivedKnot(1)!.collapsed).toBe(false);
    });

    it('throws for an unknown knot id', async () => {
      const session = await startedSessionWith(SkeinTree.newTree('dgdebug', 1));
      expect(() => session.toggleTreeNode(999)).toThrow();
    });

    it('does not touch either menu', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .setActiveKnotId(0)
      );
      session.openGraphMenu(1);

      session.toggleTreeNode(1);

      expect(session.getGraphMenuId()).toBe(1);
    });

    it("moves the active knot up to the collapsed knot when collapsing hides it - the transcript must never show what the graph pane doesn't", async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(1, 'take orb', { text: 'b', inputType: 'line' })
          .setActiveKnotId(2)
      );

      session.toggleTreeNode(1); // collapses knot 1's subtree, hiding knot 2 (the active knot)

      expect(session.getTree().getActiveKnotId()).toBe(1);
    });

    it('leaves the active knot alone when it is not inside the collapsed subtree', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
          .setActiveKnotId(2)
      );

      session.toggleTreeNode(1); // knot 2 is a sibling of 1, not a descendant

      expect(session.getTree().getActiveKnotId()).toBe(2);
    });

    it('emits a change event', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      const onChange = jest.fn();
      session.onChange(onChange);

      session.toggleTreeNode(1);

      expect(onChange).toHaveBeenCalledTimes(1);
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

    it('propagates LabelConflictError for a label another knot already carries', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
          .setLabel(1, 'checkpoint')
      );

      expect(() => session.setLabel(2, 'checkpoint')).toThrow(LabelConflictError);
      expect(session.getTree().getKnot(2)!.label).toBeNull();
    });

    // A rejected label was never a real edit - undo must not treat it as one (see session.ts's
    // own doc comment on why the tree mutation is computed before pushUndoSnapshot). Without that
    // fix, the rejected attempt would still push a snapshot equal to the already-current tree, so
    // a single undo() would silently no-op instead of reverting the genuine setLabel(1,...) edit -
    // confusing "I pressed undo and nothing happened" UX.
    it('does not waste an undo entry on a rejected (conflicting) label', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      );

      session.setLabel(1, 'checkpoint'); // a real, valid edit - pushes one undo entry
      expect(() => session.setLabel(2, 'checkpoint')).toThrow(LabelConflictError); // rejected - must not push another

      session.undo();

      expect(session.getTree().getKnot(1)!.label).toBeNull();
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

  describe('undo / redo', () => {
    it('reverts the most recent structural edit', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.blessKnot(1);
      expect(session.getTree().getDerivedKnot(1)!.state).toBe('valid');

      session.undo();

      expect(session.getTree().getDerivedKnot(1)!.state).toBe('new');
    });

    it('is a no-op when there is nothing to undo', async () => {
      mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();
      const treeBefore = session.getTree();

      session.undo();

      expect(session.getTree()).toBe(treeBefore);
    });

    it('redo re-applies the most recently undone edit', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.blessKnot(1);
      session.undo();
      expect(session.getTree().getDerivedKnot(1)!.state).toBe('new');

      session.redo();

      expect(session.getTree().getDerivedKnot(1)!.state).toBe('valid');
    });

    it('is a no-op when there is nothing to redo', async () => {
      mockReadResponse.mockResolvedValueOnce(BANNER_RESPONSE);
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();
      const treeBefore = session.getTree();

      session.redo();

      expect(session.getTree()).toBe(treeBefore);
    });

    it('discards the redo history once a fresh edit is made after an undo', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      );

      session.blessKnot(1);
      session.undo();
      session.blessKnot(2); // a fresh edit, not a redo - should invalidate the undone blessKnot(1)

      session.redo();

      expect(session.getTree().getDerivedKnot(1)!.state).toBe('new');
      expect(session.getTree().getDerivedKnot(2)!.state).toBe('valid');
    });

    it('undoes several edits in reverse order', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );

      session.setLabel(1, 'checkpoint');
      session.toggleLock(1);

      session.undo();
      expect(session.getTree().getKnot(1)!.locked).toBe(false);
      expect(session.getTree().getKnot(1)!.label).toBe('checkpoint');

      session.undo();
      expect(session.getTree().getKnot(1)!.label).toBeNull();
    });

    it('does not create its own undo point for pure navigation (setActiveKnot)', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1)
          .addChild(0, 'look', { text: 'a', inputType: 'line' })
          .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      );

      session.blessKnot(1);
      session.setActiveKnot(2);

      session.undo();

      // The single undo reverts the bless, not the navigation - setActiveKnot never pushed its
      // own point, so there's nothing separate to step back through first.
      expect(session.getTree().getDerivedKnot(1)!.state).toBe('new');
    });

    it('running a new command pushes an undo point that removes the new knot', async () => {
      mockReadResponse
        .mockResolvedValueOnce(BANNER_RESPONSE)
        .mockResolvedValueOnce({ command: 'look', response: 'Room A.\n', promptType: 'line' })
        .mockResolvedValueOnce(dynamicResponse([]));
      const session = SkeinSession.createNew(DGDEBUG_CONFIG);
      await session.start();

      await session.runCommand('look');
      expect(session.getTree().getKnot(1)).not.toBeNull();

      session.undo();

      expect(session.getTree().getKnot(1)).toBeNull();
      expect(session.getTree().getActiveKnotId()).toBe(0);
    });

    it("closes both panes' menus, like every other mutating action", async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      session.blessKnot(1);
      session.openGraphMenu(1);

      session.undo();

      expect(session.getGraphMenuId()).toBeNull();
    });

    it('emits a change event', async () => {
      const session = await startedSessionWith(
        SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' })
      );
      session.blessKnot(1);
      const listener = jest.fn();
      session.onChange(listener);

      session.undo();

      expect(listener).toHaveBeenCalled();
    });
  });
});
