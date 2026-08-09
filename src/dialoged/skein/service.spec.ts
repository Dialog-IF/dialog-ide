import * as http from 'http';
import * as path from 'path';
import { SkeinService } from './service';
import { SkeinSession } from './session';
import { SkeinTree } from './tree';

const MEDIA_ROOT = path.join(__dirname, '..', '..', '..', 'media');

/**
 * A minimal session-like double - getTree()/onChange()/offChange() are all SkeinService's
 * setActiveSession needs, so a real SkeinSession (which would need a real dgdebug process) isn't
 * necessary here, matching how process.spec.ts's tests elsewhere in this suite mock rather than
 * spawn a real interpreter.
 */
function createFakeSession(tree: SkeinTree, options: { runCommand?: (command: string) => void | Promise<void> } = {}) {
  const listeners: Array<() => void> = [];
  const runCommandCalls: string[] = [];
  return {
    getTree: () => tree,
    onChange: (fn: () => void) => listeners.push(fn),
    offChange: (fn: () => void) => {
      const index = listeners.indexOf(fn);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    emitChange: () => listeners.forEach((fn) => fn()),
    runCommandCalls,
    // Mirrors the real SkeinSession.runCommand's contract: mutates (here, just records the
    // call) and emits 'change' at the end, which is what triggers the content broadcast.
    runCommand: async (command: string) => {
      runCommandCalls.push(command);
      await options.runCommand?.(command);
      listeners.forEach((fn) => fn());
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
      expect(res.body).toContain('default.skein');
      expect(res.body).toContain('dgdebug');
      expect(res.body).toContain('25002');
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
        expect(payload).toContain('data: elements <div id="skein-app">');
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
        expect(payload.indexOf('data: elements <div id="skein-app">')).toBeLessThan(
          payload.indexOf('resetAndFocusCommandInput')
        );
        expect(payload).toContain('data: mode append');
        expect(payload).toContain('data: selector body');
        expect(payload).toContain('data-effect="el.remove()"');
      } finally {
        req.destroy();
      }
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
