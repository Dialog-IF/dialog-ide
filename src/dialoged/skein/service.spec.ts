import * as http from 'http';
import * as path from 'path';
import { SkeinService } from './service';
import { SkeinSession } from './session';
import { LabelConflictError, SkeinTree } from './tree';

const MEDIA_ROOT = path.join(__dirname, '..', '..', '..', 'media');

/**
 * A minimal session-like double - getTree()/onChange()/offChange() are all SkeinService's
 * setActiveSession needs, so a real SkeinSession (which would need a real dgdebug process) isn't
 * necessary here, matching how process.spec.ts's tests elsewhere in this suite mock rather than
 * spawn a real interpreter.
 */
function createFakeSession(
  tree: SkeinTree,
  options: {
    runCommand?: (command: string) => void | Promise<void>;
    replayToKnot?: (id: number) => void | Promise<void>;
    replayAll?: () => void | Promise<void>;
    setLabel?: (id: number, label: string | null) => void;
    traceKnot?: (id: number) => string | null | Promise<string | null>;
    traceStartup?: () => string | null | Promise<string | null>;
    getProjectRoot?: () => string;
  } = {}
) {
  const listeners: Array<() => void> = [];
  const runCommandCalls: string[] = [];
  const calls = {
    setActiveKnot: [] as number[],
    newChild: [] as number[],
    openGraphMenu: [] as number[],
    openTranscriptMenu: [] as number[],
    blessKnot: [] as number[],
    blessChanges: [] as number[],
    toggleLock: [] as number[],
    setLabel: [] as [number, string | null][],
    deleteKnot: [] as number[],
    spliceKnot: [] as number[],
    replayToKnot: [] as number[],
    replayAllCount: 0,
    closeAllMenusCount: 0,
    toggleTreeNode: [] as number[],
    undoCount: 0,
    redoCount: 0,
    toggleShowDynamicStateCount: 0,
    traceKnot: [] as number[],
    traceStartupCount: 0
  };
  const emit = () => listeners.forEach((fn) => fn());
  let showDynamicState = false;

  // Mirrors session.ts's own graphMenuId/transcriptMenuId: every mutating action (including
  // plain navigation) closes both, matching the real closeMenus() called from setActiveKnot and
  // every other mutator.
  let graphMenuId: number | null = null;
  let transcriptMenuId: number | null = null;
  const closeMenus = () => {
    graphMenuId = null;
    transcriptMenuId = null;
  };
  return {
    getTree: () => tree,
    getGraphMenuId: () => graphMenuId,
    getTranscriptMenuId: () => transcriptMenuId,
    // The real toggleTreeNode delegates to SkeinTree.toggleCollapsed (state lives on the tree
    // itself now, exposed via DerivedKnot.collapsed - see tree.spec.ts for that logic's own
    // coverage), so this fake only needs to record the call for route-wiring assertions.
    toggleTreeNode: (id: number) => {
      calls.toggleTreeNode.push(id);
      emit();
    },
    onChange: (fn: () => void) => listeners.push(fn),
    offChange: (fn: () => void) => {
      const index = listeners.indexOf(fn);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    emitChange: emit,
    runCommandCalls,
    calls,
    // Mirrors the real SkeinSession.runCommand's contract: mutates (here, just records the
    // call) and emits 'change' at the end, which is what triggers the content broadcast.
    runCommand: async (command: string) => {
      runCommandCalls.push(command);
      await options.runCommand?.(command);
      emit();
    },
    setActiveKnot: (id: number) => {
      calls.setActiveKnot.push(id);
      closeMenus();
      emit();
    },
    newChild: (id: number) => {
      calls.newChild.push(id);
      closeMenus();
      emit();
    },
    openGraphMenu: (id: number) => {
      calls.openGraphMenu.push(id);
      transcriptMenuId = null;
      graphMenuId = id;
      emit();
    },
    openTranscriptMenu: (id: number) => {
      calls.openTranscriptMenu.push(id);
      graphMenuId = null;
      transcriptMenuId = id;
      emit();
    },
    closeAllMenus: () => {
      calls.closeAllMenusCount++;
      if (graphMenuId === null && transcriptMenuId === null) return;
      closeMenus();
      emit();
    },
    blessKnot: (id: number) => {
      calls.blessKnot.push(id);
      closeMenus();
      emit();
    },
    blessChanges: (id: number) => {
      calls.blessChanges.push(id);
      closeMenus();
      emit();
    },
    toggleLock: (id: number) => {
      calls.toggleLock.push(id);
      closeMenus();
      emit();
    },
    setLabel: (id: number, label: string | null) => {
      calls.setLabel.push([id, label]);
      options.setLabel?.(id, label);
      closeMenus();
      emit();
    },
    deleteKnot: (id: number) => {
      calls.deleteKnot.push(id);
      closeMenus();
      emit();
    },
    spliceKnot: (id: number) => {
      calls.spliceKnot.push(id);
      closeMenus();
      emit();
    },
    replayToKnot: async (id: number) => {
      calls.replayToKnot.push(id);
      await options.replayToKnot?.(id);
      closeMenus();
      emit();
    },
    replayAll: async () => {
      calls.replayAllCount++;
      await options.replayAll?.();
      closeMenus();
      emit();
    },
    undo: () => {
      calls.undoCount++;
      closeMenus();
      emit();
    },
    redo: () => {
      calls.redoCount++;
      closeMenus();
      emit();
    },
    getShowDynamicState: () => showDynamicState,
    toggleShowDynamicState: () => {
      calls.toggleShowDynamicStateCount++;
      showDynamicState = !showDynamicState;
      emit();
    },
    getProjectRoot: () => options.getProjectRoot?.() ?? '/fake/project/root',
    traceKnot: async (id: number) => {
      calls.traceKnot.push(id);
      const result = (await options.traceKnot?.(id)) ?? null;
      emit();
      return result;
    },
    traceStartup: async () => {
      calls.traceStartupCount++;
      const result = (await options.traceStartup?.()) ?? null;
      emit();
      return result;
    }
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function get(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() })
        );
      })
      .on('error', reject);
  });
}

function post(url: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('SkeinService', () => {
  let service: SkeinService;

  beforeEach(async () => {
    service = new SkeinService({ port: 0, host: 'localhost', mediaRoot: MEDIA_ROOT });
    await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  describe('GET /', () => {
    it('shows a placeholder when no session is active', async () => {
      const res = await get(`http://localhost:${service.getPort()}/`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('No skein session running');
    });

    it('renders the active session once one is set', async () => {
      const tree = SkeinTree.newTree('dgdebug', 25002);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await get(`http://localhost:${service.getPort()}/`);
      expect(res.body).toContain('id="knot-0"');
    });
  });

  describe('GET /events', () => {
    it('sends the focus/reset execute-script on connect, so the command input is focused on first load without relying on cross-frame focus tricks', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      try {
        await waitFor(() => chunks.join('').includes('resetAndFocusCommandInput'));
        const payload = chunks.join('');
        expect(payload).toContain('data-effect="el.remove()"');
      } finally {
        req.destroy();
      }
    });

    it('pushes a datastar-patch-elements event when the active session changes', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });

      try {
        // The connect-time patch (sent immediately to cover the render/connect race).
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        fake.emitChange();

        await waitFor(() => chunks.length > 0);
        const payload = chunks.join('');
        expect(payload).toContain('event: datastar-patch-elements');
        expect(payload).toContain('data: elements <div id="skein-app" class="');
      } finally {
        req.destroy();
      }
    });

    it('stops pushing to a session that is no longer active', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');
      service.setActiveSession(undefined, undefined);

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });

      try {
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        fake.emitChange();
        // Give any (incorrect) push a moment to arrive, then assert none did.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(chunks.join('')).toBe('');
      } finally {
        req.destroy();
      }
    });
  });

  describe('POST /actions/send-command', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/send-command`, { newCommand: 'look' });
      expect(res.status).toBe(400);
    });

    it('runs the normalized command against the active session and returns 204', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/send-command`, {
        newCommand: '  take   orb  '
      });

      expect(res.status).toBe(204);
      expect(fake.runCommandCalls).toEqual(['take orb']);
    });

    it('no-ops (204, no runCommand call) for a blank command', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/send-command`, { newCommand: '   ' });

      expect(res.status).toBe(204);
      expect(fake.runCommandCalls).toEqual([]);
    });

    it('500s when the session fails to run the command, without broadcasting the focus script', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree, {
        runCommand: () => {
          throw new Error('process died');
        }
      });
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      try {
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        const res = await post(`http://localhost:${service.getPort()}/actions/send-command`, {
          newCommand: 'look'
        });
        expect(res.status).toBe(500);

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(chunks.join('')).not.toContain('resetAndFocusCommandInput');
      } finally {
        req.destroy();
      }
    });

    it('broadcasts a self-removing execute-script event to focus/reset the input after a successful command', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      try {
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        await post(`http://localhost:${service.getPort()}/actions/send-command`, { newCommand: 'look' });

        await waitFor(() => chunks.join('').includes('resetAndFocusCommandInput'));
        const payload = chunks.join('');
        // Content patch (from runCommand's emitted 'change') arrives before the script patch.
        expect(payload.indexOf('data: elements <div id="skein-app" class="')).toBeLessThan(
          payload.indexOf('resetAndFocusCommandInput')
        );
        expect(payload).toContain('data: mode append');
        expect(payload).toContain('data: selector body');
        expect(payload).toContain('data-effect="el.remove()"');
        // Bare call, not scrolled to a specific knot - correct here since the just-run command's
        // new response is always the newest thing on screen, right above the input already.
        expect(payload).toContain('resetAndFocusCommandInput()');
      } finally {
        req.destroy();
      }
    });
  });

  describe('POST /actions/select-knot', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/select-knot`, { knotId: 1 });
      expect(res.status).toBe(400);
    });

    it('400s when knotId is missing or not a number', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/select-knot`, { knotId: 'nope' });
      expect(res.status).toBe(400);
    });

    it('calls setActiveKnot and returns 204', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/select-knot`, { knotId: 1 });

      expect(res.status).toBe(204);
      expect(fake.calls.setActiveKnot).toEqual([1]);
    });

    // Regression: this used to broadcast a bare resetAndFocusCommandInput() (scrolling only the
    // command input into view), which happened to land on the right knot only when the clicked
    // knot was already the transcript's leaf - clicking any ancestor scrolled straight past it to
    // the bottom instead, since the transcript keeps showing the whole spine regardless of which
    // knot on it was selected (tree.ts's selectKnot never truncates it). Passing the knotId lets
    // main.js scroll that knot's own row into view instead.
    it("broadcasts the focus/reset execute-script with the selected knot's id, so it scrolls to that knot", async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      try {
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        await post(`http://localhost:${service.getPort()}/actions/select-knot`, { knotId: 1 });

        await waitFor(() => chunks.join('').includes('resetAndFocusCommandInput'));
        expect(chunks.join('')).toContain('resetAndFocusCommandInput(1)');
      } finally {
        req.destroy();
      }
    });

    it("closes any other knot's open menu - plain navigation means the user is done with it", async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      await post(`http://localhost:${service.getPort()}/actions/open-graph-menu`, { knotId: 1 });
      let res = await get(`http://localhost:${service.getPort()}/`);
      expect(res.body).toContain('<details class="dropdown dropdown-right font-sans" open style="anchor-name: --knot-menu-graph-1">');

      await post(`http://localhost:${service.getPort()}/actions/select-knot`, { knotId: 0 });
      res = await get(`http://localhost:${service.getPort()}/`);
      expect(res.body).not.toContain('<details class="dropdown dropdown-right font-sans" open style="anchor-name: --knot-menu-graph-1">');
    });
  });

  describe('POST /actions/new-child', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/new-child`, { knotId: 1 });
      expect(res.status).toBe(400);
    });

    it('400s when knotId is missing or not a number', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/new-child`, { knotId: 'nope' });
      expect(res.status).toBe(400);
    });

    it('calls session.newChild and returns 204 - distinct from select-knot, see session.ts', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/new-child`, { knotId: 1 });

      expect(res.status).toBe(204);
      expect(fake.calls.newChild).toEqual([1]);
      expect(fake.calls.setActiveKnot).toEqual([]);
    });

    it("broadcasts the focus/reset execute-script with the target knot's id - the user is about to type the new command", async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      try {
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        await post(`http://localhost:${service.getPort()}/actions/new-child`, { knotId: 1 });

        await waitFor(() => chunks.join('').includes('resetAndFocusCommandInput'));
        expect(chunks.join('')).toContain('resetAndFocusCommandInput(1)');
      } finally {
        req.destroy();
      }
    });
  });

  describe('POST /actions/open-graph-menu, open-transcript-menu', () => {
    for (const [route, callKey] of [
      ['open-graph-menu', 'openGraphMenu'],
      ['open-transcript-menu', 'openTranscriptMenu']
    ] as const) {
      it(`${route}: 400s with no session, else calls session.${callKey} and returns 204`, async () => {
        const noSessionRes = await post(`http://localhost:${service.getPort()}/actions/${route}`, { knotId: 1 });
        expect(noSessionRes.status).toBe(400);

        const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
        const fake = createFakeSession(tree);
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/${route}`, { knotId: 1 });

        expect(res.status).toBe(204);
        expect(fake.calls[callKey]).toEqual([1]);
      });

      it(`${route}: 400s when knotId is missing or not a number`, async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree);
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/${route}`, { knotId: 'nope' });
        expect(res.status).toBe(400);
      });

      it(`${route}: 500s when the session method throws`, async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = { ...createFakeSession(tree), [callKey]: () => { throw new Error('no such knot'); } };
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/${route}`, { knotId: 999 });
        expect(res.status).toBe(500);
      });
    }

    it('opening the graph pane\'s menu does not open the transcript\'s, and vice versa', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      await post(`http://localhost:${service.getPort()}/actions/open-graph-menu`, { knotId: 1 });
      expect(fake.getGraphMenuId()).toBe(1);
      expect(fake.getTranscriptMenuId()).toBeNull();

      await post(`http://localhost:${service.getPort()}/actions/open-transcript-menu`, { knotId: 1 });
      expect(fake.getGraphMenuId()).toBeNull();
      expect(fake.getTranscriptMenuId()).toBe(1);
    });
  });

  describe('POST /actions/bless-knot, bless-changes, toggle-lock, toggle-tree-node, delete-knot, splice-knot, replay-to', () => {
    const routes: [string, keyof ReturnType<typeof createFakeSession>['calls']][] = [
      ['bless-knot', 'blessKnot'],
      ['bless-changes', 'blessChanges'],
      ['toggle-lock', 'toggleLock'],
      ['toggle-tree-node', 'toggleTreeNode'],
      ['delete-knot', 'deleteKnot'],
      ['splice-knot', 'spliceKnot'],
      ['replay-to', 'replayToKnot']
    ];

    for (const [route, callKey] of routes) {
      it(`${route}: 400s with no session, else calls session.${callKey} with the knot id and returns 204`, async () => {
        const noSessionRes = await post(`http://localhost:${service.getPort()}/actions/${route}`, { knotId: 1 });
        expect(noSessionRes.status).toBe(400);

        const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
        const fake = createFakeSession(tree);
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/${route}`, { knotId: 1 });

        expect(res.status).toBe(204);
        expect(fake.calls[callKey]).toEqual([1]);
      });
    }

    it('500s when the session method throws', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = {
        ...createFakeSession(tree),
        blessKnot: () => {
          throw new Error('nope');
        }
      };
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/bless-knot`, { knotId: 0 });
      expect(res.status).toBe(500);
    });

    it("closes an open knot menu after a successful action - the user is done with it once they've used it", async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      await post(`http://localhost:${service.getPort()}/actions/open-graph-menu`, { knotId: 1 });
      await post(`http://localhost:${service.getPort()}/actions/toggle-lock`, { knotId: 1 });

      const page = await get(`http://localhost:${service.getPort()}/`);
      expect(page.body).not.toContain('<details class="dropdown dropdown-right font-sans" open style="anchor-name: --knot-menu-graph-1">');
    });

    describe('acknowledging flash', () => {
      const flashRoutes: [string, string][] = [
        ['bless-knot', 'Knot blessed'],
        ['bless-changes', 'Transcript blessed'],
        ['replay-to', 'Replayed to knot']
      ];

      for (const [route, message] of flashRoutes) {
        it(`${route} broadcasts an acknowledging "${message}" flash`, async () => {
          const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
          const fake = createFakeSession(tree);
          service.setActiveSession(fake as unknown as SkeinSession, 'default');

          const chunks: string[] = [];
          const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
            res.on('data', (chunk) => chunks.push(chunk.toString()));
          });
          try {
            await waitFor(() => chunks.length > 0); // the connect-time patch
            chunks.length = 0;

            await post(`http://localhost:${service.getPort()}/actions/${route}`, { knotId: 1 });

            await waitFor(() => chunks.join('').includes('sk.showFlash'));
            expect(chunks.join('')).toContain(`sk.showFlash(${JSON.stringify(message)})`);
          } finally {
            req.destroy();
          }
        });
      }

      it('toggle-lock does not broadcast a flash - not every action warrants one', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
        const fake = createFakeSession(tree);
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const chunks: string[] = [];
        const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
          res.on('data', (chunk) => chunks.push(chunk.toString()));
        });
        try {
          await waitFor(() => chunks.length > 0);
          chunks.length = 0;

          await post(`http://localhost:${service.getPort()}/actions/toggle-lock`, { knotId: 1 });
          // Give an (incorrect) broadcast a moment to arrive, then confirm none did - only the
          // ordinary tree-change patch should have.
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(chunks.join('')).not.toContain('sk.showFlash');
        } finally {
          req.destroy();
        }
      });
    });
  });

  describe('POST /actions/set-label', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/set-label`, { knotId: 1, label: 'x' });
      expect(res.status).toBe(400);
    });

    it('sets a trimmed label and returns 204', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/set-label`, {
        knotId: 1,
        label: '  checkpoint  '
      });

      expect(res.status).toBe(204);
      expect(fake.calls.setLabel).toEqual([[1, 'checkpoint']]);
    });

    it('treats a blank label as clearing it (null)', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      await post(`http://localhost:${service.getPort()}/actions/set-label`, { knotId: 1, label: '   ' });

      expect(fake.calls.setLabel).toEqual([[1, null]]);
    });

    it('409s with a JSON {error} body for a duplicate label - the modal reads this to show inline, not a generic 500', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree, {
        setLabel: () => {
          throw new LabelConflictError('checkpoint');
        }
      });
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/set-label`, { knotId: 1, label: 'checkpoint' });

      expect(res.status).toBe(409);
      expect(JSON.parse(res.body)).toEqual({ error: 'Label "checkpoint" is already used by another knot.' });
    });

    it('500s for any other setLabel failure', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree, {
        setLabel: () => {
          throw new Error('disk full');
        }
      });
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/set-label`, { knotId: 1, label: 'checkpoint' });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /actions/replay-all', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/replay-all`, {});
      expect(res.status).toBe(400);
    });

    it('calls session.replayAll and returns 204, with no knotId required', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/replay-all`, {});

      expect(res.status).toBe(204);
      expect(fake.calls.replayAllCount).toBe(1);
    });

    it('broadcasts an acknowledging flash on success', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      try {
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        await post(`http://localhost:${service.getPort()}/actions/replay-all`, {});

        await waitFor(() => chunks.join('').includes('sk.showFlash'));
        expect(chunks.join('')).toContain(`sk.showFlash(${JSON.stringify('Replayed all paths')})`);
      } finally {
        req.destroy();
      }
    });

    it('500s when replayAll rejects', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree, {
        replayAll: () => {
          throw new Error('process died');
        }
      });
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/replay-all`, {});
      expect(res.status).toBe(500);
    });
  });

  describe('SkeinService.withProgress (ProgressHost) / POST /actions/cancel-replay', () => {
    function listenForBroadcastScripts() {
      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      return { chunks, stop: () => req.destroy() };
    }

    it('broadcasts sk.showProgress, an sk.updateProgress per report(), and sk.hideProgress on completion', async () => {
      const { chunks, stop } = listenForBroadcastScripts();
      try {
        await waitFor(() => chunks.length > 0); // the connect-time patch
        chunks.length = 0;

        await service.withProgress({ title: 'Replaying all commands...', cancellable: true }, async (progress) => {
          progress.report({ message: 'look', increment: 50 });
          progress.report({ message: 'take orb', increment: 50 });
        });

        // The SSE writes above land on the server-side socket synchronously, but delivery to this
        // client is a real (loopback) round trip - waitFor before asserting, same as every other
        // SSE test in this file, rather than reading chunks immediately after the await above.
        await waitFor(() => chunks.join('').includes('sk.hideProgress()'));
        const payload = chunks.join('');
        expect(payload).toContain(`sk.showProgress(${JSON.stringify('Replaying all commands...')}, true)`);
        expect(payload).toContain(`sk.updateProgress(50, ${JSON.stringify('look')})`);
        expect(payload).toContain(`sk.updateProgress(100, ${JSON.stringify('take orb')})`);
        expect(payload).toContain('sk.hideProgress()');
      } finally {
        stop();
      }
    });

    // Regression: extension.ts's implicit replay-on-load (runLoadedSession) can start (and, for a
    // short replay, finish) before the webview's iframe has even navigated to GET / and opened
    // its own /events connection - the broadcasts above land in an empty sseClients set and are
    // gone forever, so the progress modal never appeared at all on load, only on a manual click
    // (where the connection already exists). handleSseConnect's currentProgress catch-up fixes
    // this: a client connecting mid-replay must see the modal immediately, not just future
    // updates.
    it('catches a newly-connecting client up on a replay already in progress, without waiting for the next report()', async () => {
      let resolveTask: (() => void) | undefined;
      const withProgressPromise = service.withProgress(
        { title: 'Replaying all commands...', cancellable: true },
        async (progress) => {
          progress.report({ message: 'look', increment: 50 });
          await new Promise<void>((resolve) => {
            resolveTask = resolve;
          });
        }
      );

      const chunks: string[] = [];
      const req = http.get(`http://localhost:${service.getPort()}/events`, (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
      });
      try {
        await waitFor(() => chunks.join('').includes('sk.showProgress'));
        const payload = chunks.join('');
        expect(payload).toContain(`sk.showProgress(${JSON.stringify('Replaying all commands...')}, true)`);
        expect(payload).toContain(`sk.updateProgress(50, ${JSON.stringify('look')})`);
      } finally {
        resolveTask?.();
        await withProgressPromise;
        req.destroy();
      }
    });

    it('still broadcasts sk.hideProgress when the task throws', async () => {
      const { chunks, stop } = listenForBroadcastScripts();
      try {
        await waitFor(() => chunks.length > 0);
        chunks.length = 0;

        await expect(
          service.withProgress({ title: 'x', cancellable: false }, async () => {
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');

        await waitFor(() => chunks.join('').includes('sk.hideProgress()'));
        expect(chunks.join('')).toContain('sk.hideProgress()');
      } finally {
        stop();
      }
    });

    it('cancel-replay flips the token passed to the in-flight withProgress task', async () => {
      const withProgressPromise = service.withProgress({ title: 'x', cancellable: true }, async (_progress, token) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return token.isCancellationRequested;
      });

      await post(`http://localhost:${service.getPort()}/actions/cancel-replay`, {});
      const wasCancelled = await withProgressPromise;

      expect(wasCancelled).toBe(true);
    });

    it('204s as a no-op when nothing is currently replaying', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/cancel-replay`, {});
      expect(res.status).toBe(204);
    });
  });

  describe('POST /actions/save', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/save`, {});
      expect(res.status).toBe(400);
    });

    it('400s when the active session has no onSave handler (setActiveSession called without one)', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default'); // no third arg

      const res = await post(`http://localhost:${service.getPort()}/actions/save`, {});
      expect(res.status).toBe(400);
    });

    it('calls the onSave handler and returns 204 - the only path that ever persists', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      let saveCalls = 0;
      service.setActiveSession(fake as unknown as SkeinSession, 'default', async () => {
        saveCalls++;
      });

      const res = await post(`http://localhost:${service.getPort()}/actions/save`, {});

      expect(res.status).toBe(204);
      expect(saveCalls).toBe(1);
    });

    it('500s when the save handler rejects', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default', async () => {
        throw new Error('disk full');
      });

      const res = await post(`http://localhost:${service.getPort()}/actions/save`, {});
      expect(res.status).toBe(500);
    });

    it('forgets the previous save handler once a different (or no) session becomes active', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      let saveCalls = 0;
      service.setActiveSession(fake as unknown as SkeinSession, 'default', async () => {
        saveCalls++;
      });
      service.setActiveSession(undefined, undefined);

      const res = await post(`http://localhost:${service.getPort()}/actions/save`, {});

      expect(res.status).toBe(400);
      expect(saveCalls).toBe(0);
    });
  });

  describe('POST /actions/close-menus', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/close-menus`, {});
      expect(res.status).toBe(400);
    });

    it('closes both open menus and returns 204', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');
      fake.openGraphMenu(1);
      fake.openTranscriptMenu(1);

      const res = await post(`http://localhost:${service.getPort()}/actions/close-menus`, {});

      expect(res.status).toBe(204);
      expect(fake.calls.closeAllMenusCount).toBe(1);
      expect(fake.getGraphMenuId()).toBeNull();
      expect(fake.getTranscriptMenuId()).toBeNull();
    });
  });

  describe('POST /actions/undo, /actions/redo', () => {
    it('400s when no session is active', async () => {
      const undoRes = await post(`http://localhost:${service.getPort()}/actions/undo`, {});
      const redoRes = await post(`http://localhost:${service.getPort()}/actions/redo`, {});
      expect(undoRes.status).toBe(400);
      expect(redoRes.status).toBe(400);
    });

    it('calls session.undo/session.redo and returns 204, with no knotId required', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const undoRes = await post(`http://localhost:${service.getPort()}/actions/undo`, {});
      const redoRes = await post(`http://localhost:${service.getPort()}/actions/redo`, {});

      expect(undoRes.status).toBe(204);
      expect(redoRes.status).toBe(204);
      expect(fake.calls.undoCount).toBe(1);
      expect(fake.calls.redoCount).toBe(1);
    });
  });

  describe('POST /actions/toggle-dynamic-state', () => {
    it('400s when no session is active', async () => {
      const res = await post(`http://localhost:${service.getPort()}/actions/toggle-dynamic-state`, {});
      expect(res.status).toBe(400);
    });

    it('calls session.toggleShowDynamicState and returns 204, with no knotId required', async () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const fake = createFakeSession(tree);
      service.setActiveSession(fake as unknown as SkeinSession, 'default');

      const res = await post(`http://localhost:${service.getPort()}/actions/toggle-dynamic-state`, {});

      expect(res.status).toBe(204);
      expect(fake.calls.toggleShowDynamicStateCount).toBe(1);
      expect(fake.getShowDynamicState()).toBe(true);
    });
  });

  describe('Trace panel routes (/trace, /trace/events, /trace/source-preview, /actions/trace-*)', () => {
    const DGSAMPLE_ROOT = path.join(__dirname, '__fixtures__', 'project', 'dgsample');
    const RAW_TRACE = [
      '| 1 ENTER (look) src/orb.dg:5',
      '| 2 QUERY (something) src/orb.dg:7',
      '| 2 FOUND (something) src/orb.dg:7'
    ].join('\n');

    describe('GET /trace', () => {
      it('shows a placeholder when nothing has been traced yet', async () => {
        const res = await get(`http://localhost:${service.getPort()}/trace`);
        expect(res.status).toBe(200);
        expect(res.body).toContain('No trace yet');
      });
    });

    describe('POST /actions/trace-knot', () => {
      it('400s when no session is active', async () => {
        const res = await post(`http://localhost:${service.getPort()}/actions/trace-knot`, { knotId: 0 });
        expect(res.status).toBe(400);
      });

      it('400s when knotId is missing/invalid', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree);
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/trace-knot`, {});
        expect(res.status).toBe(400);
      });

      it('400s when session.traceKnot returns null (e.g. root, or a non-dgdebug engine)', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree, { traceKnot: () => null });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/trace-knot`, { knotId: 0 });
        expect(res.status).toBe(400);
      });

      it('500s when session.traceKnot rejects', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
        const fake = createFakeSession(tree, {
          traceKnot: () => {
            throw new Error('process died');
          }
        });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/trace-knot`, { knotId: 1 });
        expect(res.status).toBe(500);
      });

      it("parses the raw response into the trace tree, labels it with the knot's own command, and broadcasts it over /trace/events", async () => {
        const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
        const fake = createFakeSession(tree, { traceKnot: (id) => (id === 1 ? RAW_TRACE : null) });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const chunks: string[] = [];
        const req = http.get(`http://localhost:${service.getPort()}/trace/events`, (res) => {
          res.on('data', (chunk) => chunks.push(chunk.toString()));
        });
        try {
          await waitFor(() => chunks.length > 0);
          chunks.length = 0;

          const res = await post(`http://localhost:${service.getPort()}/actions/trace-knot`, { knotId: 1 });
          expect(res.status).toBe(204);
          expect(fake.calls.traceKnot).toEqual([1]);

          await waitFor(() => chunks.join('').includes('(look)'));
          const broadcast = chunks.join('');
          expect(broadcast).toContain('(look)');
          expect(broadcast).toContain('ENTER');

          const page = await get(`http://localhost:${service.getPort()}/trace`);
          expect(page.body).toContain('(look)');
          expect(page.body).toContain('src/orb.dg:5');
        } finally {
          req.destroy();
        }
      });

      it('displays an absolute source path relative to the project root, not verbatim', async () => {
        const absoluteRawTrace = `| 1 ENTER (look) ${path.join(DGSAMPLE_ROOT, 'src', 'orb.dg')}:5`;
        const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
        const fake = createFakeSession(tree, {
          traceKnot: (id) => (id === 1 ? absoluteRawTrace : null),
          getProjectRoot: () => DGSAMPLE_ROOT
        });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        await post(`http://localhost:${service.getPort()}/actions/trace-knot`, { knotId: 1 });

        const page = await get(`http://localhost:${service.getPort()}/trace`);
        expect(page.body).toContain('src/orb.dg:5');
        expect(page.body).not.toContain(DGSAMPLE_ROOT);
      });

      it('calls onTraceRequested (revealing the panel) before attempting the trace, even when it then 400s - but not when the request itself is malformed', async () => {
        const onTraceRequested = jest.fn();
        const revealingService = new SkeinService({ port: 0, host: 'localhost', mediaRoot: MEDIA_ROOT, onTraceRequested });
        await revealingService.start();
        try {
          const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
          const fake = createFakeSession(tree, { traceKnot: (id) => (id === 1 ? RAW_TRACE : null) });

          // No active session yet - never gets far enough to reveal anything.
          await post(`http://localhost:${revealingService.getPort()}/actions/trace-knot`, { knotId: 1 });
          expect(onTraceRequested).not.toHaveBeenCalled();

          revealingService.setActiveSession(fake as unknown as SkeinSession, 'default');

          // Malformed body (no knotId) - a client error caught before any real work starts.
          await post(`http://localhost:${revealingService.getPort()}/actions/trace-knot`, {});
          expect(onTraceRequested).not.toHaveBeenCalled();

          // Valid knotId that traceKnot then rejects (no such knot, per the fake above) - still
          // reveals the panel first, since "show the spinner, then do the work" doesn't know the
          // outcome yet at reveal time.
          await post(`http://localhost:${revealingService.getPort()}/actions/trace-knot`, { knotId: 999 });
          expect(onTraceRequested).toHaveBeenCalledTimes(1);

          await post(`http://localhost:${revealingService.getPort()}/actions/trace-knot`, { knotId: 1 });
          expect(onTraceRequested).toHaveBeenCalledTimes(2);
        } finally {
          await revealingService.stop();
        }
      });

      it('broadcasts a loading state immediately, before the trace itself resolves', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
        let resolveTrace: (value: string | null) => void = () => {};
        const fake = createFakeSession(tree, {
          traceKnot: () => new Promise<string | null>((resolve) => { resolveTrace = resolve; })
        });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const chunks: string[] = [];
        const req = http.get(`http://localhost:${service.getPort()}/trace/events`, (res) => {
          res.on('data', (chunk) => chunks.push(chunk.toString()));
        });
        try {
          await waitFor(() => chunks.length > 0);
          chunks.length = 0;

          const postPromise = post(`http://localhost:${service.getPort()}/actions/trace-knot`, { knotId: 1 });
          await waitFor(() => chunks.join('').includes('loading-spinner'));

          const pageWhileLoading = await get(`http://localhost:${service.getPort()}/trace`);
          expect(pageWhileLoading.body).toContain('loading-spinner');

          resolveTrace(RAW_TRACE);
          await postPromise;

          const pageAfter = await get(`http://localhost:${service.getPort()}/trace`);
          expect(pageAfter.body).not.toContain('loading-spinner');
          expect(pageAfter.body).toContain('(look)');
        } finally {
          req.destroy();
        }
      });
    });

    describe('POST /actions/trace-startup', () => {
      it('400s when no session is active', async () => {
        const res = await post(`http://localhost:${service.getPort()}/actions/trace-startup`, {});
        expect(res.status).toBe(400);
      });

      it('400s when session.traceStartup returns null', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree, { traceStartup: () => null });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/trace-startup`, {});
        expect(res.status).toBe(400);
      });

      it('500s when session.traceStartup rejects', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree, {
          traceStartup: () => {
            throw new Error('boom');
          }
        });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/trace-startup`, {});
        expect(res.status).toBe(500);
      });

      it('parses the raw response, labelled "startup"', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree, { traceStartup: () => RAW_TRACE });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');

        const res = await post(`http://localhost:${service.getPort()}/actions/trace-startup`, {});
        expect(res.status).toBe(204);
        expect(fake.calls.traceStartupCount).toBe(1);

        const page = await get(`http://localhost:${service.getPort()}/trace`);
        expect(page.body).toContain('startup');
        expect(page.body).toContain('(look)');
      });
    });

    describe('POST /actions/trace-search, trace-toggle-node, trace-expand-all, trace-collapse-all', () => {
      async function traced() {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree, { traceStartup: () => RAW_TRACE });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');
        await post(`http://localhost:${service.getPort()}/actions/trace-startup`, {});
        return fake;
      }

      it('400s for each when nothing has been traced yet', async () => {
        const searchRes = await post(`http://localhost:${service.getPort()}/actions/trace-search`, { searchTerm: 'x' });
        const toggleRes = await post(`http://localhost:${service.getPort()}/actions/trace-toggle-node`, { nodeId: 1 });
        const expandRes = await post(`http://localhost:${service.getPort()}/actions/trace-expand-all`, {});
        const collapseRes = await post(`http://localhost:${service.getPort()}/actions/trace-collapse-all`, {});

        expect([searchRes.status, toggleRes.status, expandRes.status, collapseRes.status]).toEqual([400, 400, 400, 400]);
      });

      it('trace-expand-all reveals children; trace-collapse-all hides them again', async () => {
        await traced();

        let page = await get(`http://localhost:${service.getPort()}/trace`);
        expect(page.body).not.toContain('(something)'); // new nodes start collapsed

        await post(`http://localhost:${service.getPort()}/actions/trace-expand-all`, {});
        page = await get(`http://localhost:${service.getPort()}/trace`);
        expect(page.body).toContain('(something)');

        await post(`http://localhost:${service.getPort()}/actions/trace-collapse-all`, {});
        page = await get(`http://localhost:${service.getPort()}/trace`);
        expect(page.body).not.toContain('(something)');
      });

      it('trace-toggle-node expands just that one node', async () => {
        await traced();

        await post(`http://localhost:${service.getPort()}/actions/trace-toggle-node`, { nodeId: 1 });
        const page = await get(`http://localhost:${service.getPort()}/trace`);
        expect(page.body).toContain('(something)');
      });

      it('trace-search marks matches and expands their ancestors so results are visible', async () => {
        await traced();

        await post(`http://localhost:${service.getPort()}/actions/trace-search`, { searchTerm: 'something' });
        const page = await get(`http://localhost:${service.getPort()}/trace`);
        expect(page.body).toContain('(something)');
        expect(page.body).toContain('trace-row-match');
      });
    });

    describe('GET /trace/source-preview', () => {
      it('404s when nothing has been traced yet', async () => {
        const res = await get(`http://localhost:${service.getPort()}/trace/source-preview?nodeId=1`);
        expect(res.status).toBe(404);
      });

      it('404s for a node with no source (the invisible root)', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree, { traceStartup: () => RAW_TRACE, getProjectRoot: () => DGSAMPLE_ROOT });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');
        await post(`http://localhost:${service.getPort()}/actions/trace-startup`, {});

        const res = await get(`http://localhost:${service.getPort()}/trace/source-preview?nodeId=0`);
        expect(res.status).toBe(404);
      });

      it('renders a snippet around the target line when a real file resolves against the project root', async () => {
        const tree = SkeinTree.newTree('dgdebug', 1);
        const fake = createFakeSession(tree, { traceStartup: () => RAW_TRACE, getProjectRoot: () => DGSAMPLE_ROOT });
        service.setActiveSession(fake as unknown as SkeinSession, 'default');
        await post(`http://localhost:${service.getPort()}/actions/trace-startup`, {});

        const res = await get(`http://localhost:${service.getPort()}/trace/source-preview?nodeId=1`);
        expect(res.status).toBe(200);
        expect(res.body).toContain('trace-source-line');
        expect(res.body).toContain('highlighted');
      });
    });
  });

  describe('static asset routes', () => {
    it('serves the vendored style.css', async () => {
      const res = await get(`http://localhost:${service.getPort()}/style.css`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/css');
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('serves the vendored datastar.js', async () => {
      const res = await get(`http://localhost:${service.getPort()}/js/datastar.js`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/javascript');
      expect(res.body).toContain('Datastar');
    });

    it('serves the client main.js', async () => {
      const res = await get(`http://localhost:${service.getPort()}/js/main.js`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/javascript');
      expect(res.body).toContain('resetAndFocusCommandInput');
    });

    it('serves the trace panel\'s own client trace.js', async () => {
      const res = await get(`http://localhost:${service.getPort()}/js/trace.js`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/javascript');
      expect(res.body).toContain('openSource');
    });

    it('serves a vendored icon by name', async () => {
      const res = await get(`http://localhost:${service.getPort()}/icons/exclamation-triangle.svg`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.body).toContain('<svg');
    });

    it('404s for an unknown icon rather than escaping mediaRoot', async () => {
      const res = await get(`http://localhost:${service.getPort()}/icons/../../../../etc/passwd`);
      expect(res.status).toBe(404);
    });
  });
});
