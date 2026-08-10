/**
 * Web service interface for the Skein engine.
 * Provides HTTP endpoints for UI communication using TypeScript Datastar library approach.
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SkeinSession } from './session';
import { LabelConflictError, SkeinTree } from './tree';
import { renderApp, renderPage, SessionDisplayInfo } from './ui/render';
import { ProgressHost, ProgressReporter, CancellationToken } from './progress';

/**
 * Service configuration
 */
export interface ServiceConfig {
  port: number;
  host: string;
  /** Absolute path to the vendored static assets (style.css, js/datastar.js, icons/*.svg). */
  mediaRoot: string;
}

/**
 * SSE Event type
 */
export interface SseEvent {
  type: string;
  data: any;
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const NO_ACTIVE_SESSION_FRAGMENT = '<div id="skein-app" class="p-4">No skein session running.</div>';

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Trims and collapses internal whitespace, matching dialog-tool's own normalize-input. */
function normalizeCommand(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Parses a JSON request body into a plain object, tolerating empty/invalid bodies as `{}`. */
function parseJsonBody(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Reads a validated integer `knotId` out of a parsed JSON body, or null if missing/invalid. */
function parseKnotId(payload: Record<string, unknown>): number | null {
  const { knotId } = payload;
  return typeof knotId === 'number' && Number.isInteger(knotId) ? knotId : null;
}

/**
 * Class for managing the web service interface
 */
export class SkeinService implements ProgressHost {
  private config: ServiceConfig;
  private sessions: Map<string, SkeinSession> = new Map();
  private isRunning: boolean = false;
  private server: http.Server | undefined;
  private port: number | undefined;

  private activeSession: SkeinSession | undefined;
  private activeSessionId: string | undefined;
  // Persists the active session's tree to its .skein file - provided by whoever calls
  // setActiveSession (extension.ts owns the project root/PersistenceManager, which this service
  // has no knowledge of). Explicit-save-only: nothing in this class ever calls this on its own
  // initiative, only POST /actions/save. Undefined when no session is active.
  private saveHandler: (() => Promise<void>) | undefined;
  private readonly sseClients = new Set<http.ServerResponse>();
  private readonly onActiveSessionChange = (): void => this.broadcast();
  // Set only while a withProgress() call (SkeinSession.replayAll's progressHost) is in flight -
  // POST /actions/cancel-replay flips it. At most one replay is ever in flight at a time (the UI
  // only ever shows one progress modal), so a single field is enough - see withProgress's own doc
  // comment for why this class is the ProgressHost rather than a native vscode wrapper.
  private cancelCurrentReplay: (() => void) | null = null;
  // Mirrors whatever withProgress last broadcast, null once it's done - see handleSseConnect's use
  // of this: extension.ts's implicit replay-on-load can start (and finish) a whole replayAll
  // before the webview's iframe has even navigated to GET / and opened its /events connection, so
  // a client connecting mid-replay (or, in the fast/small case, just after) needs to be caught up
  // rather than silently missing broadcasts that already fired into an empty sseClients set.
  private currentProgress: { title: string; cancellable: boolean; percent: number; message: string | null } | null =
    null;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  /**
   * Start the web service: renders the real (read-only, for now) skein transcript over plain
   * Datastar SSE - see the Phase 1 plan for the wire-protocol research this is based on
   * (dialog-tool's own Hyper framework, traced down to genuine Datastar `datastar-patch-elements`
   * events over a long-held GET /events connection).
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Service already running');
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('Skein service request failed:', error);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.port, this.config.host, resolve);
    });

    const address = this.server.address();
    this.port = typeof address === 'object' && address !== null ? address.port : this.config.port;
    this.isRunning = true;
  }

  /**
   * Stop the web service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Clean up all sessions
    for (const session of this.sessions.values()) {
      await session.stop();
    }
    this.sessions.clear();

    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    if (this.activeSession) {
      this.activeSession.offChange(this.onActiveSessionChange);
      this.activeSession = undefined;
      this.activeSessionId = undefined;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = undefined;
    this.port = undefined;
    this.isRunning = false;
  }

  /**
   * The actual bound port - differs from config.port when config.port is 0 (OS-assigned).
   */
  public getPort(): number {
    if (this.port === undefined) {
      throw new Error('Service is not running');
    }
    return this.port;
  }

  /**
   * Tells the web UI which session to render. Subscribes to the session's change notifications
   * (see session.ts's onChange) so the SSE loop can push a fresh render whenever the tree
   * mutates; unsubscribes from whichever session was previously active. Pass undefined for both
   * arguments when no session is running. onSave backs the navbar's Save button (POST
   * /actions/save) - the caller (extension.ts) owns the project root/PersistenceManager this
   * service has no knowledge of, so it provides the actual persistence closure.
   */
  public setActiveSession(
    session: SkeinSession | undefined,
    sessionId: string | undefined,
    onSave?: () => Promise<void>
  ): void {
    if (this.activeSession) {
      this.activeSession.offChange(this.onActiveSessionChange);
    }

    this.activeSession = session;
    this.activeSessionId = sessionId;
    this.saveHandler = onSave;

    if (this.activeSession) {
      this.activeSession.onChange(this.onActiveSessionChange);
    }

    this.broadcast();
  }

  private currentDisplayInfo(): SessionDisplayInfo | undefined {
    if (!this.activeSession || !this.activeSessionId) {
      return undefined;
    }
    const tree = this.activeSession.getTree();
    return { sessionId: this.activeSessionId, engine: tree.getEngine(), seed: tree.getSeed() };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderPage(
          this.currentDisplayInfo(),
          this.activeSession?.getTree(),
          this.activeSession?.getGraphMenuId() ?? null,
          this.activeSession?.getTranscriptMenuId() ?? null
        )
      );
      return;
    }

    if (url.pathname === '/events') {
      this.handleSseConnect(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/send-command') {
      await this.handleSendCommand(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/select-knot') {
      await this.handleKnotAction(req, res, (session, knotId) => session.setActiveKnot(knotId), {
        focusAfter: true
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/new-child') {
      // The actions menu's "New Child" (and main.js's Option+A) - distinct from plain select-knot:
      // session.newChild clears the target's own selectedChild so the transcript stops there,
      // ready for a genuinely new command, rather than auto-showing whatever's already explored
      // past it. Relies on the command input's own replay-if-stale guard (session.ts's runCommand)
      // for the actual new command, so it needs no route of its own beyond focusing the input.
      await this.handleKnotAction(req, res, (session, knotId) => session.newChild(knotId), { focusAfter: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/open-graph-menu') {
      await this.handleKnotAction(req, res, (session, knotId) => session.openGraphMenu(knotId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/open-transcript-menu') {
      await this.handleKnotAction(req, res, (session, knotId) => session.openTranscriptMenu(knotId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/bless-knot') {
      await this.handleKnotAction(req, res, (session, knotId) => session.blessKnot(knotId), { flashMessage: 'Knot blessed' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/bless-changes') {
      await this.handleKnotAction(req, res, (session, knotId) => session.blessChanges(knotId), {
        flashMessage: 'Transcript blessed'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/toggle-lock') {
      await this.handleKnotAction(req, res, (session, knotId) => session.toggleLock(knotId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/toggle-tree-node') {
      await this.handleKnotAction(req, res, (session, knotId) => session.toggleTreeNode(knotId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/set-label') {
      await this.handleSetLabel(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/delete-knot') {
      await this.handleKnotAction(req, res, (session, knotId) => session.deleteKnot(knotId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/splice-knot') {
      await this.handleKnotAction(req, res, (session, knotId) => session.spliceKnot(knotId));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/replay-to') {
      await this.handleKnotAction(req, res, (session, knotId) => session.replayToKnot(knotId), {
        flashMessage: 'Replayed to knot'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/cancel-replay') {
      await this.handleCancelReplay(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/replay-all') {
      await this.handleReplayAll(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/undo') {
      await this.handleUndoRedo(req, res, (session) => session.undo());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/redo') {
      await this.handleUndoRedo(req, res, (session) => session.redo());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/save') {
      await this.handleSave(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/close-menus') {
      await this.handleCloseMenus(req, res);
      return;
    }

    if (url.pathname === '/style.css') {
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'style.css'));
      return;
    }

    if (url.pathname === '/js/datastar.js') {
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'js', 'datastar.js'));
      return;
    }

    if (url.pathname === '/js/main.js') {
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'js', 'main.js'));
      return;
    }

    if (url.pathname.startsWith('/icons/')) {
      // path.basename strips any directory traversal from the requested name.
      const name = path.basename(url.pathname.slice('/icons/'.length));
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'icons', name));
      return;
    }

    res.writeHead(404);
    res.end();
  }

  /**
   * POST /actions/send-command - the one action route this pass needs. Datastar's @post()
   * sends the page's current signals as a JSON body; the only signal on this page is
   * newCommand (see render.ts's renderCommandInput). Runs the command against the active
   * session (its existing onChange -> broadcast wiring pushes the updated transcript), then
   * broadcasts an execute-script event to clear/refocus the input - see the Command Input plan
   * for why that's a separate SSE event rather than something the content patch can carry.
   * Returns a bare 204: the real UI update travels over the SSE channel, not this response.
   */
  private async handleSendCommand(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    const signals = parseJsonBody(await readRequestBody(req));
    const rawCommand = signals.newCommand;
    const command = normalizeCommand(typeof rawCommand === 'string' ? rawCommand : '');

    if (command === '') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      await this.activeSession.runCommand(command);
    } catch (error) {
      console.error('Failed to run command:', error);
      res.writeHead(500);
      res.end();
      return;
    }

    this.broadcastScript('sk.resetAndFocusCommandInput()');
    res.writeHead(204);
    res.end();
  }

  /**
   * Shared plumbing for the actions-menu / navbar knot actions (select-knot, new-child,
   * open-graph-menu, open-transcript-menu, bless-knot, bless-changes, toggle-lock,
   * toggle-tree-node, delete-knot, splice-knot, replay-to): parses {knotId} from the JSON body,
   * requires an active session, runs fn, and
   * responds 204/400/500 - the same shape as handleSendCommand. session.ts's own methods already
   * manage graphMenuId/transcriptMenuId (opening or closing them) as part of the same state
   * update that emits 'change', so there's nothing left for this to do about menu state - one
   * broadcast, already correct. set-label and replay-all have their own handlers below since
   * their request/response shapes don't quite fit this one (an extra field; no knot id at all).
   * flashMessage is only set for the handful of actions worth an explicit "yes, that happened"
   * acknowledgement (bless, replay) - see broadcastFlash's doc comment.
   */
  private async handleKnotAction(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    fn: (session: SkeinSession, knotId: number) => void | Promise<void>,
    options: { focusAfter?: boolean; flashMessage?: string } = {}
  ): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    const knotId = parseKnotId(parseJsonBody(await readRequestBody(req)));
    if (knotId === null) {
      res.writeHead(400);
      res.end();
      return;
    }

    try {
      await fn(this.activeSession, knotId);
    } catch (error) {
      console.error('Knot action failed:', error);
      res.writeHead(500);
      res.end();
      return;
    }

    if (options.flashMessage) {
      this.broadcastFlash(options.flashMessage);
    }
    if (options.focusAfter) {
      this.broadcastScript('sk.resetAndFocusCommandInput()');
    }
    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/set-label - {knotId, label}; a blank/missing label clears it (setLabel(id,
   * null)). A duplicate label is an expected, user-facing rejection (labels are tree-unique - see
   * tree.ts's LabelConflictError), not a bug: 409 with a JSON {error} body the label modal reads
   * and displays inline, distinct from the generic 500 every other unexpected failure gets.
   */
  private async handleSetLabel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    const payload = parseJsonBody(await readRequestBody(req));
    const knotId = parseKnotId(payload);
    if (knotId === null) {
      res.writeHead(400);
      res.end();
      return;
    }
    const rawLabel = payload.label;
    const label = typeof rawLabel === 'string' && rawLabel.trim() !== '' ? rawLabel.trim() : null;

    try {
      this.activeSession.setLabel(knotId, label);
    } catch (error) {
      if (error instanceof LabelConflictError) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
      console.error('Failed to set label:', error);
      res.writeHead(500);
      res.end();
      return;
    }

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/replay-all - the navbar's Replay All. No knotId: session.replayAll() always
   * targets the active spine's own leaf.
   */
  private async handleReplayAll(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    // No fields to read, but the body still needs draining - an unread POST body left on a
    // keep-alive connection would corrupt the next request parsed off the same socket.
    await readRequestBody(req);

    try {
      await this.activeSession.replayAll();
    } catch (error) {
      console.error('Replay All failed:', error);
      res.writeHead(500);
      res.end();
      return;
    }

    this.broadcastFlash('Replayed all commands');
    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/cancel-replay - the progress modal's Cancel button (see withProgress). A no-op,
   * not a 400, when nothing is actually replaying: the button and the replay it targets are on
   * independent timers (SSE broadcast vs. the in-flight fetch), so a click landing just after the
   * replay already finished on its own is normal, not an error.
   */
  private async handleCancelReplay(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    await readRequestBody(req);
    this.cancelCurrentReplay?.();
    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/save - the navbar's Save button, and the only path that ever writes the
   * session's tree to its .skein file (see setActiveSession's onSave doc comment). No fields to
   * read; still drains the body per the usual keep-alive reasoning.
   */
  private async handleSave(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession || !this.saveHandler) {
      res.writeHead(400);
      res.end();
      return;
    }

    await readRequestBody(req);

    try {
      await this.saveHandler();
    } catch (error) {
      console.error('Failed to save session:', error);
      res.writeHead(500);
      res.end();
      return;
    }

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/close-menus - no body. Backs main.js's click-outside-the-open-dropdown
   * listener: native <details> has no built-in dismiss-on-outside-click, so that's plain JS
   * calling this to keep the server (session.ts's graphMenuId/transcriptMenuId, the source of
   * truth for the native `open` attribute) in sync with what the click already closed visually.
   */
  private async handleCloseMenus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    await readRequestBody(req);
    this.activeSession.closeAllMenus();

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/undo and /actions/redo - main.js's document-level Cmd+Z/Shift+Cmd+Z listener.
   * No body/knotId (there's nothing to target - undo/redo always act on whatever's on top of
   * session.ts's own undo/redo stack); a no-op rather than an error when the stack is empty, same
   * reasoning as handleCancelReplay's doc comment.
   */
  private async handleUndoRedo(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    fn: (session: SkeinSession) => void
  ): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    await readRequestBody(req);
    fn(this.activeSession);

    res.writeHead(204);
    res.end();
  }

  private handleSseConnect(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));

    // Covers the race between the initial GET / render and this connection opening.
    this.sendPatch(res);
    // Also focuses the command input on first load - triggered here (the page's own script
    // reacting to its own server over its own already-open connection) rather than via a
    // cross-frame contentWindow.focus()/postMessage from the embedding webview, which turned
    // out not to reliably move focus into a nested cross-origin iframe. A no-op via
    // resetAndFocusCommandInput's own null-check when there's no input to focus (no session, or
    // a keystroke-prompt placeholder instead).
    this.sendScript(res, 'sk.resetAndFocusCommandInput()');

    // Catches this client up on a replay that's already in flight - see currentProgress's own
    // doc comment for why this is needed (not just a nice-to-have): without it, a replay that
    // starts before this connection exists broadcasts into an empty sseClients set and the
    // progress modal never appears at all, only the final flash once the tree itself re-renders.
    if (this.currentProgress) {
      const { title, cancellable, percent, message } = this.currentProgress;
      this.sendScript(res, `sk.showProgress(${JSON.stringify(title)}, ${JSON.stringify(cancellable)})`);
      this.sendScript(res, `sk.updateProgress(${percent}, ${JSON.stringify(message)})`);
    }
  }

  private broadcast(): void {
    for (const client of this.sseClients) {
      this.sendPatch(client);
    }
  }

  /**
   * Writes a real Datastar `datastar-patch-elements` SSE event: each line of the fragment gets
   * its own "data: elements " prefix (SSE's data field is line-oriented - a bare multi-line
   * value would be silently mangled), matching dialog-tool's own Hyper framework's wire format.
   */
  private sendPatch(res: http.ServerResponse): void {
    if (res.writableEnded) {
      return;
    }

    const info = this.currentDisplayInfo();
    const tree = this.activeSession?.getTree();
    const html =
      info && tree
        ? renderApp(info, tree, this.activeSession!.getGraphMenuId(), this.activeSession!.getTranscriptMenuId())
        : NO_ACTIVE_SESSION_FRAGMENT;
    const dataLines = html
      .split('\n')
      .map((line) => `data: elements ${line}`)
      .join('\n');

    res.write(`event: datastar-patch-elements\n${dataLines}\n\n`);
  }

  private broadcastScript(js: string): void {
    for (const client of this.sseClients) {
      this.sendScript(client, js);
    }
  }

  /**
   * An acknowledging flash for actions worth an explicit "yes, that happened" confirmation
   * (bless, replay, replay all) - routine navigation/selection actions don't get one, since the
   * transcript updating is already the confirmation. Ported from dialog-tool's own flash!/
   * sk.showFlash (top-center, single-flash-at-a-time, fades out on its own) - reuses
   * broadcastScript's script-append channel rather than baking a flash container into renderApp's
   * own markup, so it's unaffected by the ordinary #skein-app morph a tree change triggers.
   */
  private broadcastFlash(message: string): void {
    this.broadcastScript(`sk.showFlash(${JSON.stringify(message)})`);
  }

  /**
   * ProgressHost implementation for SkeinSession.replayAll (see progress.ts's doc comment for why
   * that's an injected interface rather than a direct dependency): dialog-tool's own replay-all
   * shows a real in-page progress modal, not a native OS/editor dialog, and its Cancel button
   * actually works here (dialog-tool's own :continue flag is set but never read anywhere -
   * confirmed by inspecting its source - so its Cancel button is silently inert; this one isn't).
   * Broadcasts sk.showProgress/updateProgress/hideProgress over the same script-append channel as
   * broadcastFlash - percent is accumulated here from each report()'s increment (0-100) rather
   * than threading a running total through the wire, since ProgressReporter's contract is already
   * increment-based (see session.ts's replayTo). cancelCurrentReplay is how POST
   * /actions/cancel-replay reaches back into the token captured by this specific call.
   */
  public async withProgress<T>(
    options: { title: string; cancellable: boolean },
    task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>
  ): Promise<T> {
    const token: CancellationToken = { isCancellationRequested: false };
    this.cancelCurrentReplay = () => {
      token.isCancellationRequested = true;
    };
    this.currentProgress = { title: options.title, cancellable: options.cancellable, percent: 0, message: null };
    this.broadcastScript(`sk.showProgress(${JSON.stringify(options.title)}, ${JSON.stringify(options.cancellable)})`);
    const progress: ProgressReporter = {
      report: (update) => {
        const percent = Math.min(100, this.currentProgress!.percent + (update.increment ?? 0));
        const message = update.message ?? null;
        this.currentProgress = { ...this.currentProgress!, percent, message };
        this.broadcastScript(`sk.updateProgress(${percent}, ${JSON.stringify(message)})`);
      }
    };
    try {
      return await task(progress, token);
    } finally {
      this.cancelCurrentReplay = null;
      this.currentProgress = null;
      this.broadcastScript('sk.hideProgress()');
    }
  }

  /**
   * A self-removing <script> appended to <body> - genuine Datastar behavior (not hyper-specific):
   * `data-effect` runs once the element connects, then it removes itself. Wire format confirmed
   * from hyper's own effects.clj (format-execute-script-event) - see the Command Input plan.
   */
  private sendScript(res: http.ServerResponse, js: string): void {
    if (res.writableEnded) {
      return;
    }

    res.write(
      'event: datastar-patch-elements\n' +
        'data: mode append\n' +
        'data: selector body\n' +
        `data: elements <script data-effect="el.remove()">${js}</script>\n\n`
    );
  }

  private async serveStaticFile(res: http.ServerResponse, filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath);
      const contentType = STATIC_CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }

  /**
   * Create a new session
   */
  public createSession(config: any): SkeinSession {
    const session = SkeinSession.createNew(config);
    this.sessions.set(session.getId(), session);
    return session;
  }

  /**
   * Load an existing session
   */
  public loadSession(tree: SkeinTree, config: any): SkeinSession {
    const session = SkeinSession.createLoaded(tree, config);
    this.sessions.set(session.getId(), session);
    return session;
  }

  /**
   * Get a session by ID
   */
  public getSession(id: string): SkeinSession | null {
    return this.sessions.get(id) || null;
  }

  /**
   * Get all active sessions
   */
  public getAllSessions(): SkeinSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Handle skein-related requests (simplified)
   */
  public async handleSkeinEndpoints(): Promise<void> {
    // This would be implemented with actual HTTP routing for:
    // - Session creation
    // - Command execution
    // - Tree data retrieval
    // - SSE event streaming

    console.log('Handling skein endpoints...');
  }

  /**
   * Serve UI components (simplified)
   */
  public serveUiComponents(): void {
    // This would serve the reactive UI components
    console.log('Serving UI components...');
  }

  /**
   * Send SSE updates to connected clients
   */
  public sendSseUpdate(event: SseEvent): void {
    // In a real implementation, this would stream events to connected clients
    console.log(`Sending SSE update: ${event.type}`, event.data);
  }

  /**
   * Check if service is running
   */
  public isRunningService(): boolean {
    return this.isRunning;
  }
}