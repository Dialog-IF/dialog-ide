/**
 * Web service interface for the Skein engine.
 * Provides HTTP endpoints for UI communication using TypeScript Datastar library approach.
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IGrammar } from 'vscode-textmate';
import { SkeinSession } from './session';
import { DialogCompileError } from './compile-error';
import { CommandConflictError, KnotLockedError, LabelConflictError, SkeinTree } from './tree';
import { renderApp, renderPage, SessionDisplayInfo } from './ui/render';
import { searchKnots, SearchResults } from './search';
import { renderTraceApp, renderTracePage, CurrentTraceState } from './ui/traceRender';
import { ProgressHost, ProgressReporter, CancellationToken } from './progress';
import {
  buildTraceTree,
  collapseAll,
  expandAll,
  expandToMatches,
  getNode,
  parseSource,
  searchTree,
  toggleExpanded,
  TraceTree
} from './trace';
import { loadDialogGrammar, renderHighlightedSnippet, renderPlainSnippet } from './syntax';

/**
 * Service configuration
 */
export interface ServiceConfig {
  port: number;
  host: string;
  /** Absolute path to the vendored static assets (style.css, js/datastar.js, icons/*.svg). */
  mediaRoot: string;
  /** Resolved path to the installed dialog-language-support extension's .tmLanguage.json grammar
   *  (extension.ts resolves this via vscode.extensions - see syntax.ts) - used to syntax-color
   *  the trace panel's hover/source snippets. Undefined falls back to plain, uncolored snippets. */
  grammarPath?: string;
  /** Called after a successful trace-knot/trace-startup (not on every search/toggle re-render) -
   *  extension.ts uses this to reveal/focus the native Trace panel view, since VS Code doesn't
   *  auto-show a newly contributed panel-area view on its own; the user otherwise has to find it
   *  manually via the panel's own "Views" menu once, the first time. This class has no vscode
   *  API access itself (see CLAUDE.md's engine/IDE-integration split), hence the callback. */
  onTraceRequested?: () => void;
  /** Called whenever an action against the active session fails with a DialogCompileError (a
   *  replay/restart hit a source error - see session.ts's DialogCompileError throw sites) -
   *  extension.ts uses this to open the offending file and annotate the error there. This class
   *  has no vscode API access itself (see CLAUDE.md's engine/IDE-integration split), hence the
   *  callback. */
  onCompileError?: (error: DialogCompileError) => void;
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

// The keystroke command-input's own special-name buttons (render.ts's renderKeystrokeInput) -
// deliberately not run through normalizeCommand above, which would collapse/trim away the one
// keystroke (a literal space) that's pure whitespace.
const SPECIAL_KEYSTROKES = new Set(['enter', 'space', 'backspace']);

/**
 * Validates and normalizes a keystroke reply's raw signal value: either one of the three special
 * names (from renderKeystrokeInput's buttons) or a single character (from its text field's own
 * keydown handler) - anything else (an empty/missing signal, or multiple characters) isn't a
 * valid single keystroke, so this returns null rather than forwarding it on to the process.
 * Normalizes a literal space character to the same "space" text the button sends, so the knot's
 * stored command reads the same regardless of which the user actually used - not just for
 * cosmetics: tree.ts's findChildId matches commands by exact text, so leaving the two forms
 * distinct would let the same reply be recorded as two different sibling knots.
 */
function normalizeKeystroke(text: string): string | null {
  if (text === ' ') {
    return 'space';
  }
  if (text.length === 1 || SPECIAL_KEYSTROKES.has(text)) {
    return text;
  }
  return null;
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

/** Reads a validated integer `nodeId` out of a parsed JSON body - a trace tree's own id space,
 *  distinct from a skein knot id, so this is deliberately not parseKnotId under another name. */
function parseNodeId(payload: Record<string, unknown>): number | null {
  const { nodeId } = payload;
  return typeof nodeId === 'number' && Number.isInteger(nodeId) ? nodeId : null;
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
  // The trace panel's own state - a second, independent SSE audience from sseClients above (see
  // extension.ts's TraceViewProvider, a separate webview from the main skein panel). Never
  // persisted, never part of SkeinTree - wholesale-regenerated by the next trace, discarded on
  // session switch (see setActiveSession).
  private currentTrace: CurrentTraceState | null = null;
  // The transcript's own search box (render.ts's renderSearchBox) - unlike currentTrace, this
  // holds only the query text, not the results: search.ts's searchKnots is cheap enough (see its
  // own doc comment) that results are just recomputed fresh against the current tree on every
  // sendPatch rather than cached here. Reset on session switch (see setActiveSession) so a new
  // session doesn't inherit a stale query with nothing behind it yet.
  private searchQuery = '';
  // True for the window between a trace-knot/trace-startup request landing and its result coming
  // back (a real replay plus a real dgdebug round trip - can take a few seconds) - broadcast
  // before doing any of that work so the panel shows a spinner immediately, rather than looking
  // idle until it's already done. Cleared on the same success/failure paths that set it.
  private traceLoading = false;
  private readonly traceSseClients = new Set<http.ServerResponse>();
  // Lazily loaded (and memoized) on first use, not at construction - loadDialogGrammar does real
  // I/O (reading + parsing the grammar file, spinning up oniguruma's wasm), wasted work for a
  // session that never opens the trace panel at all.
  private grammarPromise: Promise<IGrammar> | null = null;

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

    for (const client of this.traceSseClients) {
      client.end();
    }
    this.traceSseClients.clear();

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

    // A trace from a previous (or now-cleared) session is stale, and its sourceKnotId/nodeIds
    // wouldn't resolve against whatever tree is active now - drop it rather than leave the Trace
    // panel showing a result from a session that's no longer running.
    this.currentTrace = null;
    this.traceLoading = false;
    this.broadcastTrace();

    // Same reasoning: a query typed against a previous session's tree has nothing to match
    // against here, so don't carry it over.
    this.searchQuery = '';

    this.broadcast();
  }

  private currentDisplayInfo(): SessionDisplayInfo | undefined {
    if (!this.activeSession || !this.activeSessionId) {
      return undefined;
    }
    const tree = this.activeSession.getTree();
    return { sessionId: this.activeSessionId, engine: tree.getEngine(), seed: tree.getSeed() };
  }

  /**
   * Recomputed fresh from the current tree and searchQuery on every render (GET / and every SSE
   * patch) rather than cached alongside searchQuery itself - search.ts's searchKnots is cheap
   * enough (see its own doc comment) that there's nothing worth invalidating.
   */
  private currentSearchResults(): SearchResults {
    const tree = this.activeSession?.getTree();
    return tree ? searchKnots(tree, this.searchQuery) : { results: [], totalMatches: 0 };
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
          this.activeSession?.getTranscriptMenuId() ?? null,
          this.activeSession?.getShowDynamicState() ?? false,
          this.searchQuery,
          this.currentSearchResults()
        )
      );
      return;
    }

    if (url.pathname === '/events') {
      this.handleSseConnect(res);
      return;
    }

    if (url.pathname === '/trace') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderTracePage(this.currentTrace, this.traceLoading));
      return;
    }

    if (url.pathname === '/trace/events') {
      this.handleTraceSseConnect(res);
      return;
    }

    if (url.pathname === '/trace/source-preview') {
      await this.handleTraceSourcePreview(url, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/send-command') {
      await this.handleSendCommand(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/send-keystroke') {
      await this.handleSendKeystroke(req, res);
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

    if (req.method === 'POST' && url.pathname === '/actions/set-command') {
      await this.handleSetCommand(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/search') {
      await this.handleSearch(req, res);
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

    if (req.method === 'POST' && url.pathname === '/actions/toggle-dynamic-state') {
      await this.handleToggleDynamicState(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/trace-knot') {
      await this.handleTraceKnot(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/trace-startup') {
      await this.handleTraceStartup(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/trace-search') {
      await this.handleTraceSearch(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/trace-toggle-node') {
      await this.handleTraceToggleNode(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/trace-expand-all') {
      await this.handleTraceExpandCollapseAll(req, res, expandAll);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/actions/trace-collapse-all') {
      await this.handleTraceExpandCollapseAll(req, res, collapseAll);
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

    if (url.pathname === '/js/trace.js') {
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'js', 'trace.js'));
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
   * Every action's catch block does the same two things beyond its own cleanup (log, respond
   * 500) - except a DialogCompileError also needs to reach extension.ts, the only layer with
   * vscode API access, so it can open the offending source file and annotate the error there.
   */
  private reportIfCompileError(error: unknown): void {
    if (error instanceof DialogCompileError) {
      this.config.onCompileError?.(error);
    }
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
      this.reportIfCompileError(error);
      res.writeHead(500);
      res.end();
      return;
    }

    this.broadcastScript('sk.resetAndFocusCommandInput()');
    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/send-keystroke - the keystroke command-input's counterpart to send-command
   * (render.ts's renderKeystrokeInput, shown instead of the normal text field whenever the active
   * knot's response ends on a keystroke prompt - see tree.ts's promptTypeAt). Its signal is
   * newKeystroke, not newCommand, and deliberately skipped through normalizeKeystroke rather than
   * normalizeCommand - collapsing whitespace would destroy a literal space reply.
   *
   * Otherwise identical to handleSendCommand: session.ts's runCommand itself decides whether to
   * actually send this as a keystroke (based on the same promptTypeAt check, not which route was
   * hit - see its own doc comment), so this route's only job is picking the right widget's signal
   * and validating it's a single reply rather than typed line text.
   */
  private async handleSendKeystroke(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    const signals = parseJsonBody(await readRequestBody(req));
    const rawKeystroke = signals.newKeystroke;
    const keystroke = normalizeKeystroke(typeof rawKeystroke === 'string' ? rawKeystroke : '');

    if (keystroke === null) {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      await this.activeSession.runCommand(keystroke);
    } catch (error) {
      console.error('Failed to send keystroke:', error);
      this.reportIfCompileError(error);
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
   * requires an active session, runs fn, and responds 204/400/409/500 - the same shape as
   * handleSendCommand. On success, session.ts's own methods already manage graphMenuId/
   * transcriptMenuId (opening or closing them) as part of the same state update that emits
   * 'change', so there's nothing left for this to do about menu state there; on failure, fn never
   * reaches that call, so the catch block below closes menus itself (see its own comment). set-
   * label and replay-all have their own handlers below since their request/response shapes don't
   * quite fit this one (an extra field; no knot id at all). flashMessage is only set for the
   * handful of actions worth an explicit "yes, that happened" acknowledgement (bless, replay) -
   * see broadcastFlash's doc comment.
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
      // fn threw before ever reaching its own closeMenus() (session.ts's mutators only close menus
      // as part of the same update that emits 'change' - see this method's own doc comment), so
      // the popover the action was invoked from would otherwise stay open (no SSE patch ever
      // arrives to morph it closed) even though the user is just as done with it as on success.
      // closeAllMenus is a no-op (no extra broadcast) when nothing was open.
      this.activeSession.closeAllMenus();

      // An expected, user-facing rejection (tree.ts's deleteKnot won't delete a locked knot or
      // descendant) - not a bug, so it gets an error flash (postAction's callers never look at
      // the response body, unlike handleSetLabel's dedicated 409+JSON path for its own modal) and
      // a 409, not a 500/console.error.
      if (error instanceof KnotLockedError) {
        this.broadcastFlash(error.message, 'error');
        res.writeHead(409);
        res.end();
        return;
      }
      console.error('Knot action failed:', error);
      this.reportIfCompileError(error);
      res.writeHead(500);
      res.end();
      return;
    }

    if (options.flashMessage) {
      this.broadcastFlash(options.flashMessage);
    }
    if (options.focusAfter) {
      // Passing knotId (unlike handleSendCommand/handleSseConnect's own bare calls below) tells
      // main.js's resetAndFocusCommandInput to scroll *that* knot's transcript row into view
      // instead of always the command input - see its own doc comment for why select-knot and
      // new-child both need this: the transcript keeps showing the whole spine root-to-leaf
      // regardless of which knot was clicked (tree.ts's selectKnot never truncates it), so
      // scrolling to the input alone only happened to land on the right knot when it was already
      // the leaf - clicking any ancestor scrolled straight past it to the bottom instead.
      this.broadcastScript(`sk.resetAndFocusCommandInput(${knotId})`);
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
   * POST /actions/set-command - {knotId, command}. Unlike set-label, a blank command is rejected
   * outright (session.ts's setCommand throws) rather than treated as "clear" - a knot has to have
   * *some* command text. A sibling collision is an expected, user-facing rejection (command
   * uniqueness is scoped to siblings, not tree-wide like labels - tree.ts's CommandConflictError):
   * 409 with a JSON {error} body the command modal reads and displays inline, same shape as
   * handleSetLabel's own 409 path. Unlike setLabel, this does touch the process (it replays the
   * edited knot to capture its new response), so a genuine failure can be a DialogCompileError -
   * reported the same way every other replay-triggering handler already does.
   */
  private async handleSetCommand(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
    const command = typeof payload.command === 'string' ? payload.command : '';

    try {
      await this.activeSession.setCommand(knotId, command);
    } catch (error) {
      if (error instanceof CommandConflictError) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
      console.error('Failed to set command:', error);
      this.reportIfCompileError(error);
      res.writeHead(500);
      res.end();
      return;
    }

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/search - {searchQuery}, the transcript's search box (render.ts's
   * renderSearchBox - data-bind="searchQuery" is what puts this field in Datastar's signals, and
   * therefore in every @post()'s JSON body, under this exact name). Unlike every other action,
   * this doesn't touch SkeinSession at all - it's pure UI state on this class (searchQuery's own
   * doc comment), so there's no session.ts method to call and nothing here can throw a
   * session-specific error; just record the query and broadcast a fresh patch
   * (currentSearchResults recomputes the actual matches at render time).
   */
  private async handleSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    const payload = parseJsonBody(await readRequestBody(req));
    this.searchQuery = typeof payload.searchQuery === 'string' ? payload.searchQuery : '';

    this.broadcast();
    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/replay-all - the navbar's Replay All. No knotId: session.replayAll() replays
   * every leaf in the tree, then restores whichever spine was active beforehand.
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
      this.reportIfCompileError(error);
      res.writeHead(500);
      res.end();
      return;
    }

    this.broadcastFlash('Replayed all paths');
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
   * POST /actions/toggle-dynamic-state - no body. The navbar's dynamic-state toggle button
   * (render.ts's renderNavbar); flips session.ts's showDynamicState, a pure display filter that
   * doesn't touch the tree - dynamic state itself is always captured after every dgdebug command
   * regardless of whether this is on (see session.ts's captureDynamicState).
   */
  private async handleToggleDynamicState(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    await readRequestBody(req);
    this.activeSession.toggleShowDynamicState();

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/trace-knot - {knotId}, the per-knot "Trace" menu item (knot-menu.ts). Reveals
   * the panel and broadcasts a loading spinner BEFORE doing any of the actual work below (a real
   * replay plus a real dgdebug round trip, which can take a few seconds) - the panel should look
   * like something is happening right away, not stay looking idle until it's already done, and
   * onTraceRequested()/broadcastTrace() are cheap enough that firing them unconditionally (even
   * for a request that turns out to 400/500) is simpler than trying to predict the outcome
   * first. Replays to the knot's parent and re-runs its command bracketed by (trace on)/(trace
   * off) (see session.ts's traceKnot), then parses the raw response into the Trace panel's own
   * tree and broadcasts it - independent of the main transcript's own SSE stream, which still
   * gets refreshed as usual since traceKnot's own replayTo/dynamic capture already emit
   * session.ts's ordinary 'change' event.
   */
  private async handleTraceKnot(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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

    this.traceLoading = true;
    this.config.onTraceRequested?.();
    this.broadcastTrace();

    let raw: string | null;
    try {
      raw = await this.activeSession.traceKnot(knotId);
    } catch (error) {
      console.error('Trace knot failed:', error);
      this.reportIfCompileError(error);
      this.traceLoading = false;
      this.broadcastTrace();
      res.writeHead(500);
      res.end();
      return;
    }

    this.traceLoading = false;
    if (raw === null) {
      this.broadcastTrace();
      res.writeHead(400);
      res.end();
      return;
    }

    const knot = this.activeSession.getTree().getKnot(knotId);
    this.currentTrace = {
      tree: buildTraceTree(raw),
      commandLabel: knot?.command ?? '',
      sourceKnotId: knotId,
      searchTerm: '',
      projectRoot: this.activeSession.getProjectRoot()
    };
    this.broadcastTrace();

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/trace-startup - no body. The navbar's "Trace Startup" button: relaunches with
   * an extra --trace flag to capture the traced startup banner, then restarts cleanly (see
   * session.ts's traceStartup). Same reveal-then-spinner-then-work sequencing as handleTraceKnot
   * above - see its doc comment.
   */
  private async handleTraceStartup(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.activeSession) {
      res.writeHead(400);
      res.end();
      return;
    }

    await readRequestBody(req);

    this.traceLoading = true;
    this.config.onTraceRequested?.();
    this.broadcastTrace();

    let raw: string | null;
    try {
      raw = await this.activeSession.traceStartup();
    } catch (error) {
      console.error('Trace startup failed:', error);
      this.reportIfCompileError(error);
      this.traceLoading = false;
      this.broadcastTrace();
      res.writeHead(500);
      res.end();
      return;
    }

    this.traceLoading = false;
    if (raw === null) {
      this.broadcastTrace();
      res.writeHead(400);
      res.end();
      return;
    }

    this.currentTrace = {
      tree: buildTraceTree(raw),
      commandLabel: 'startup',
      sourceKnotId: null,
      searchTerm: '',
      projectRoot: this.activeSession.getProjectRoot()
    };
    this.broadcastTrace();

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/trace-search - {searchTerm}, the trace panel's own filter box. Marks matches
   * and expands every ancestor of a match (trace.ts's searchTree + expandToMatches) so results
   * are actually visible without a separate manual expand step.
   */
  private async handleTraceSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.currentTrace) {
      res.writeHead(400);
      res.end();
      return;
    }

    const payload = parseJsonBody(await readRequestBody(req));
    const searchTerm = typeof payload.searchTerm === 'string' ? payload.searchTerm : '';

    const searched = searchTree(this.currentTrace.tree, searchTerm);
    this.currentTrace = { ...this.currentTrace, tree: expandToMatches(searched), searchTerm };
    this.broadcastTrace();

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/trace-toggle-node - {nodeId}, a trace row's own expand/collapse chevron.
   * nodeId is the trace tree's own id space, not a skein knot id - see parseNodeId.
   */
  private async handleTraceToggleNode(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.currentTrace) {
      res.writeHead(400);
      res.end();
      return;
    }

    const nodeId = parseNodeId(parseJsonBody(await readRequestBody(req)));
    if (nodeId === null) {
      res.writeHead(400);
      res.end();
      return;
    }

    this.currentTrace = { ...this.currentTrace, tree: toggleExpanded(this.currentTrace.tree, nodeId) };
    this.broadcastTrace();

    res.writeHead(204);
    res.end();
  }

  /**
   * POST /actions/trace-expand-all and /actions/trace-collapse-all - no body; the trace panel's
   * own toolbar buttons.
   */
  private async handleTraceExpandCollapseAll(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    fn: (tree: TraceTree) => TraceTree
  ): Promise<void> {
    if (!this.currentTrace) {
      res.writeHead(400);
      res.end();
      return;
    }

    await readRequestBody(req);
    this.currentTrace = { ...this.currentTrace, tree: fn(this.currentTrace.tree) };
    this.broadcastTrace();

    res.writeHead(204);
    res.end();
  }

  /**
   * GET /trace/source-preview?nodeId=N - the hover popover's own fragment (media/js/trace.js).
   * Resolves the node's "file:line" source against the active session's project root, reads a
   * 9-line window (4 before/4 after, matching dialog-tool's own source-preview handler) around
   * the target line, and renders it syntax-highlighted if a Dialog grammar path was configured
   * (see ServiceConfig.grammarPath/syntax.ts), or plain text otherwise.
   */
  private async handleTraceSourcePreview(url: URL, res: http.ServerResponse): Promise<void> {
    const nodeIdParam = url.searchParams.get('nodeId');
    const nodeId = nodeIdParam !== null ? Number(nodeIdParam) : NaN;

    if (!this.currentTrace || !this.activeSession || Number.isNaN(nodeId)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Source not found');
      return;
    }

    const node = getNode(this.currentTrace.tree, nodeId);
    const parsed = node?.source ? parseSource(node.source) : null;
    if (!parsed) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Source not found');
      return;
    }

    const [filePath, line] = parsed;
    const resolvedPath = path.resolve(this.activeSession.getProjectRoot(), filePath);

    let content: string;
    try {
      content = await fs.readFile(resolvedPath, 'utf8');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Source not found');
      return;
    }

    const allLines = content.split('\n');
    const context = 4;
    const start = Math.max(0, line - context - 1);
    const end = Math.min(allLines.length, line + context);

    const html = this.config.grammarPath
      ? renderHighlightedSnippet(await this.getGrammar(), allLines, start, end, line)
      : renderPlainSnippet(allLines, start, end, line);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /** Lazily loads (and memoizes) the Dialog grammar - see ServiceConfig.grammarPath. Only called
   *  when grammarPath is set, so the non-null assertion in loadDialogGrammar's caller is safe. */
  private getGrammar(): Promise<IGrammar> {
    if (!this.grammarPromise) {
      this.grammarPromise = loadDialogGrammar(this.config.grammarPath!);
    }
    return this.grammarPromise;
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

  private handleTraceSseConnect(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    this.traceSseClients.add(res);
    res.on('close', () => this.traceSseClients.delete(res));

    // Covers the race between the initial GET /trace render and this connection opening - same
    // reasoning as handleSseConnect's own catch-up sendPatch call.
    this.sendTracePatch(res);
  }

  private broadcastTrace(): void {
    for (const client of this.traceSseClients) {
      this.sendTracePatch(client);
    }
  }

  /** The Trace panel's own datastar-patch-elements write - see sendPatch's doc comment for the
   *  wire format; this just retargets it at #trace-app/traceSseClients instead. */
  private sendTracePatch(res: http.ServerResponse): void {
    if (res.writableEnded) {
      return;
    }

    const html = renderTraceApp(this.currentTrace, this.traceLoading);
    const dataLines = html
      .split('\n')
      .map((line) => `data: elements ${line}`)
      .join('\n');

    res.write(`event: datastar-patch-elements\n${dataLines}\n\n`);
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
        ? renderApp(
            info,
            tree,
            this.activeSession!.getGraphMenuId(),
            this.activeSession!.getTranscriptMenuId(),
            this.activeSession!.getShowDynamicState(),
            this.searchQuery,
            this.currentSearchResults()
          )
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
   * A flash notification - 'info' (default) for an acknowledging "yes, that happened"
   * confirmation (bless, replay, replay all - routine navigation/selection actions don't get one,
   * since the transcript updating is already the confirmation); 'error' for an expected,
   * user-facing rejection (e.g. handleKnotAction's KnotLockedError branch) that has no other UI to
   * surface through, since postAction's fire-and-forget callers never look at the response.
   * Ported from dialog-tool's own flash!/sk.showFlash (top-center, single-flash-at-a-time) -
   * reuses broadcastScript's script-append channel rather than baking a flash container into
   * renderApp's own markup, so it's unaffected by the ordinary #skein-app morph a tree change
   * triggers.
   */
  private broadcastFlash(message: string, type: 'info' | 'error' = 'info'): void {
    // Omits the second argument entirely for the (far more common) 'info' case, rather than
    // always passing it explicitly, purely so the wire format for every existing info flash
    // (and the tests asserting on it) stays byte-for-byte unchanged now that this takes a type.
    const args = type === 'info' ? JSON.stringify(message) : `${JSON.stringify(message)}, ${JSON.stringify(type)}`;
    this.broadcastScript(`sk.showFlash(${args})`);
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