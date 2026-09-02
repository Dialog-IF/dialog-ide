/**
 * Real (non-mocked) integration test for `dgbuild new-skein` / `open-skein` - exercises the actual
 * SkeinService + SkeinSession lifecycle behind startSkeinServer against a live dgdebug process,
 * including the standalone Quit / shutdown flow. Kept unmocked in its own file, matching
 * run-skein-integration.spec.ts; skips itself when dgdebug isn't on PATH.
 */

import { execFileSync } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startSkeinServer } from './skein-server';

function isDgdebugAvailable(): boolean {
  try {
    execFileSync('dgdebug', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfDgdebug = isDgdebugAvailable() ? describe : describe.skip;

function get(port: number, pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: 'localhost', port, path: pathname }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

function post(port: number, pathname: string, body: unknown = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

/** Connects to an SSE endpoint and returns everything received within `ms`. */
function collectSse(port: number, pathname: string, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port, path: pathname }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      setTimeout(() => {
        req.destroy();
        resolve(text);
      }, ms);
    });
    req.on('error', reject);
  });
}

describeIfDgdebug('startSkeinServer (real dgdebug)', () => {
  jest.setTimeout(20000);

  const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-skein-server-'));
    fs.cpSync(FIXTURE_ROOT, tempRoot, { recursive: true });
    fs.rmSync(path.join(tempRoot, 'demo-diff.skein'), { force: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('new: serves a standalone UI, creates the .skein, and shuts down on force-quit', async () => {
    const started = await startSkeinServer({
      projectRoot: tempRoot,
      sessionId: 'default',
      mode: 'new',
      seed: 42,
      theme: 'dark',
      port: 0,
      verbose: false
    });
    try {
      const page = await get(started.port, '/?theme=dark');
      expect(page.status).toBe(200);
      expect(page.body).toContain('data-standalone="true"');
      expect(page.body).toContain('data-theme="dark"');
      expect(page.body).toContain("@post('/actions/quit')");

      expect(fs.existsSync(path.join(tempRoot, 'default.skein'))).toBe(true);
      expect(started.isDirty()).toBe(false);

      const trace = await get(started.port, '/trace?theme=dark');
      expect(trace.status).toBe(200);
      expect(trace.body).toContain('data-standalone="true"');

      // Force-quit: server broadcasts the shutdown screen and fires onQuit (waitForQuit resolves).
      const ssePromise = collectSse(started.port, '/events', 700);
      expect(await post(started.port, '/actions/quit?force=1')).toBe(204);
      expect(await ssePromise).toContain('sk.showShutdownScreen()');
      await started.waitForQuit;
    } finally {
      await started.shutdown();
    }
  });

  it('quit with unsaved changes shows the confirm modal instead of shutting down', async () => {
    const started = await startSkeinServer({
      projectRoot: tempRoot,
      sessionId: 'default',
      mode: 'new',
      seed: 42,
      theme: 'light',
      port: 0,
      verbose: false
    });
    try {
      // A real command mutates the tree, so the skein is now dirty.
      expect(await post(started.port, '/actions/send-command', { newCommand: 'look' })).toBe(204);
      expect(started.isDirty()).toBe(true);

      const ssePromise = collectSse(started.port, '/events', 700);
      expect(await post(started.port, '/actions/quit')).toBe(204);
      const sse = await ssePromise;
      expect(sse).toContain('sk.showQuitModal()');
      expect(sse).not.toContain('sk.showShutdownScreen()');

      // Save, then a plain quit is clean and proceeds to shutdown.
      expect(await post(started.port, '/actions/save')).toBe(204);
      expect(started.isDirty()).toBe(false);
      const sse2Promise = collectSse(started.port, '/events', 700);
      expect(await post(started.port, '/actions/quit')).toBe(204);
      expect(await sse2Promise).toContain('sk.showShutdownScreen()');
      await started.waitForQuit;
    } finally {
      await started.shutdown();
    }
  });

  it('open: replays on load and is clean (the replay is not counted as an edit)', async () => {
    // Seed a real, saved skein with one blessed command.
    const seed = await startSkeinServer({
      projectRoot: tempRoot,
      sessionId: 'default',
      mode: 'new',
      seed: 42,
      theme: 'light',
      port: 0,
      verbose: false
    });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { host: 'localhost', port: seed.port, path: '/actions/send-command', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify({ newCommand: 'look' }));
    });
    await post(seed.port, '/actions/bless-changes', { knotId: 1 });
    await post(seed.port, '/actions/save');
    await seed.shutdown();

    const opened = await startSkeinServer({
      projectRoot: tempRoot,
      sessionId: 'default',
      mode: 'open',
      theme: 'light',
      port: 0,
      verbose: false
    });
    try {
      expect(opened.isDirty()).toBe(false);
      const page = await get(opened.port, '/');
      expect(page.body).toContain('data-dirty="false"');
    } finally {
      await opened.shutdown();
    }
  });
});
