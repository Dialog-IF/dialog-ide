/**
 * Session management for the Skein engine.
 * Orchestrates command execution and maintains session state.
 */

import * as os from 'os';
import { EventEmitter } from 'events';
import { SkeinProcess, ProcessConfig, EngineType } from './process';
import { SkeinTree, Response } from './tree';
import { DynamicProcessor, DynamicState, DynamicChanges } from './dynamic';
import { readProject, expandSources } from './project';
import { ProgressHost, CancellationToken, noopProgressHost } from './progress';

const DYNAMIC_COMMAND = '@dynamic';
// dialog-tool's start-debug-process! filters sources by :target :dgdebug when launching the
// debugger - not the project's configured build target (:zblorb/:aa/...) - so files suffixed
// for a specific compile target (e.g. "effects.zblorb.dg") are excluded from a dgdebug run.
const DGDEBUG_TARGET_FILTER = 'dgdebug';
// How many leaves replayAll replays concurrently - mirrors dialog-tool's own parallel replay-all
// (several dgdebug processes at a time, merged afterward), scaled to the machine rather than a
// flat constant, but capped well below "one process per core" since each dgdebug also does real
// disk/parse work of its own at startup and a huge tree could otherwise spawn dozens at once.
const REPLAY_ALL_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length));

/**
 * One leaf's worth of independent replay: every knot response captured along its root-to-leaf
 * path (including knot 0's banner), the id it actually reached, and the still-running process
 * that produced them - replayAll decides afterward whether to keep that process (if this was the
 * originally-active spine's own leaf) or terminate it once its results are merged in.
 */
interface LeafReplayResult {
  leafId: number;
  process: SkeinProcess;
  responses: Map<number, Response>;
  reachedId: number;
}

/**
 * Runs worker(item) for every item in items, at most limit at a time, returning results in
 * items' own order regardless of which one actually finishes first. Just enough of a bounded
 * worker-pool to replay several leaves' dgdebug processes concurrently in replayAll without
 * spawning one per leaf all at once for a large tree - not a generic dependency, so it stays
 * this small and local rather than pulling in a library for it.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  engine: EngineType;
  seed: number;
  projectRoot: string;
}

/**
 * Session state
 */
export interface SessionState {
  id: string;
  config: SessionConfig;
  tree: SkeinTree;
  process: SkeinProcess | null;
  isRunning: boolean;
}

/**
 * Class for managing Skein sessions
 */
export class SkeinSession {
  private id: string;
  private config: SessionConfig;
  private tree: SkeinTree;
  private process: SkeinProcess | null = null;
  private isRunning: boolean = false;
  private dynamicProcessor: DynamicProcessor;
  private dynamicState: DynamicState | null = null;
  private dynamicChanges: DynamicChanges | null = null;
  private readonly changeEmitter = new EventEmitter();
  // Where the actual interpreter process currently is, as opposed to tree.getActiveKnotId() -
  // which is also the currently *displayed*/navigated-to knot, and can diverge from this once
  // clicking a knot elsewhere in the tree is possible. Purely an optimization for runCommand to
  // know whether it needs to replay first, not a correctness gate - jumping around the tree and
  // typing a new command from an earlier knot is normal, everyday use (dgdebug restarts and
  // replays fast), so the replay it triggers is silent, not an error.
  private processPositionId: number = 0;
  // Which knot has its actions menu expanded, tracked separately per pane - the graph pane and
  // the transcript can show the same knot at different tree positions (or, on the transcript,
  // not at all if it's off the active spine), so a single shared id would open both panes' menus
  // together whenever they happened to agree on the active knot. Both close on any mutating
  // action or plain navigation (setActiveKnot) - see closeMenus.
  private graphMenuId: number | null = null;
  private transcriptMenuId: number | null = null;
  // Snapshot-based undo/redo (Cmd+Z/Shift+Cmd+Z) over structural tree edits - bless/unbless,
  // delete/splice, label/lock changes, and running a new command. SkeinTree is immutable (every
  // mutator returns a new instance rather than changing the existing one in place), so a
  // "snapshot" is just the old this.tree reference, not a deep copy. Deliberately excludes pure
  // navigation (setActiveKnot, menu toggles, collapse/expand) and replay (replayTo/replayAll/
  // replayToKnot only re-validates already-recorded responses, it doesn't create a new edit) -
  // see pushUndoSnapshot's call sites for the exact boundary.
  private undoStack: SkeinTree[] = [];
  private redoStack: SkeinTree[] = [];
  // False for createNew: the tree's knot 0 is only ever SkeinTree.newTree's synthetic
  // placeholder, which was never a real, meaningful "blessed" response - there's nothing to
  // diff the live banner against, so start() force-blesses it (see launchProcessAndCaptureBanner).
  // True for createLoaded: knot 0 already carries a real, previously-blessed response loaded
  // from a .skein file, exactly like every other knot - the live banner should be diffed
  // against it like anything else, not silently overwritten-and-blessed.
  private hasLoadedHistory = false;
  // Where to route Replay All's progress/cancellation - noopProgressHost (a plain immediate call,
  // no real dialog) everywhere except extension.ts's real sessions, which inject the
  // vscode.window.withProgress-backed host. See progress.ts's doc comment for why this is a
  // dialoged-specific interface rather than an import of 'vscode' itself.
  private readonly progressHost: ProgressHost;

  constructor(config: SessionConfig, progressHost: ProgressHost = noopProgressHost) {
    this.id = this.generateId();
    this.config = config;
    this.tree = SkeinTree.newTree(config.engine, config.seed);
    this.dynamicProcessor = new DynamicProcessor();
    this.progressHost = progressHost;
  }

  /**
   * Generate a unique session ID
   */
  private generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a new session with fresh tree
   */
  public static createNew(config: SessionConfig, progressHost?: ProgressHost): SkeinSession {
    return new SkeinSession(config, progressHost);
  }

  /**
   * Create a session from an existing tree
   */
  public static createLoaded(tree: SkeinTree, config: SessionConfig, progressHost?: ProgressHost): SkeinSession {
    const session = new SkeinSession(config, progressHost);
    session.tree = tree;
    session.hasLoadedHistory = true;
    return session;
  }

  /**
   * Start the session and interpreter process
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Session already running');
    }

    try {
      // Force-bless knot 0 only when there's genuinely nothing meaningful to diff it against
      // (a brand-new tree's placeholder) - a loaded session's knot 0 is real prior history and
      // should be validated like any other knot, so an edited-and-reloaded .skein file (or a
      // banner that changed because a source file changed) shows up as a change instead of
      // silently vanishing. See launchProcessAndCaptureBanner's doc comment.
      this.tree = await this.launchProcessAndCaptureBanner(this.tree, !this.hasLoadedHistory);
      this.isRunning = true;
      this.processPositionId = 0;

      console.log(`Session ${this.id} started successfully`);
      this.changeEmitter.emit('change');
    } catch (error) {
      console.error('Failed to start session:', error);
      throw error;
    }
  }

  /**
   * Spawns a fresh interpreter process (assigned to this.process - the live process handle is
   * always session-level, never batched) and captures its startup banner as knot 0's response on
   * top of the given tree, returning the updated tree rather than touching this.tree directly -
   * so replayPathAgainstFreshProcess's callers (replayTo, replayAll) decide when, or whether, to
   * commit it to session state. Replaces SkeinTree.newTree's generic "Welcome to the game."
   * placeholder - io.ts's tag-line parser already separates the prompt from the content, so
   * (unlike the placeholder) this doesn't carry a trailing "> " into the displayed text.
   * updateKnotResponse only ever sets the *unblessed* response; blessRoot controls whether it's
   * then immediately promoted (see start()'s call site for when that's appropriate and when it
   * isn't) or left for the normal diffing logic to surface as a change, exactly like every other
   * knot. Shared by start() and replayPathAgainstFreshProcess, which always passes false - by the
   * time a replay runs, knot 0 already has *some* real blessed response (from an earlier start())
   * that a changed banner should be diffed against, not silently overwritten - the same
   * re-validation every other knot on the replay path gets.
   */
  private async launchProcessAndCaptureBanner(tree: SkeinTree, blessRoot: boolean): Promise<SkeinTree> {
    this.process = new SkeinProcess(this.buildProcessConfig());
    await this.process.start();

    const banner = await this.process.readResponse();
    let updated = tree.updateKnotResponse(0, { text: banner.response, inputType: banner.promptType });
    if (blessRoot) {
      updated = updated.blessKnot(0);
    }
    return updated;
  }

  /**
   * Reads the project and expands its sources into the ProcessConfig the running engine
   * needs. dgdebug interprets source files directly; frotz/frotz-release need a compiled game
   * (a dialogc pre-flight build step, which doesn't exist yet - see technical-design.md's
   * Process Management section for the dfrotz/frotz-release compile-time distinction).
   */
  private buildProcessConfig(): ProcessConfig {
    const { engine, seed, projectRoot } = this.config;

    if (engine !== 'dgdebug') {
      throw new Error(`${engine} is not yet supported - compiling a game file isn't implemented`);
    }

    const project = readProject(projectRoot);
    const sourceFiles = expandSources(project, { debug: true, target: DGDEBUG_TARGET_FILTER });

    return { engine, seed, sourceFiles, binDir: project.binDir };
  }

  /**
   * Run a command in the session
   */
  public async runCommand(command: string): Promise<void> {
    if (!this.isRunning || !this.process) {
      throw new Error('Session not running');
    }

    const parentId = this.tree.getActiveKnotId();
    if (parentId === null) {
      throw new Error('No active knot to run the command from');
    }

    // processPositionId tracking is purely an optimization, not a correctness gate: jumping
    // around the tree and adding new commands from an earlier knot is normal, everyday use, not
    // an error condition - dgdebug starts and replays fast enough that this is cheap. When the
    // active knot isn't where the process currently is, replay there first (silently - the user
    // already made the only decision that matters, typing a new command), then proceed exactly
    // as if the process had been there all along.
    if (parentId !== this.processPositionId) {
      await this.replayTo(parentId);
    }

    try {
      // Captured as a local: replayTo above may have swapped in a new SkeinProcess instance, and
      // narrowing from the guard at the top of this method doesn't survive that reassignment.
      const process = this.process!;
      process.sendCommand(command);
      const response = await process.readResponse();
      const newResponse = { text: response.response, inputType: response.promptType };

      // Snapshot after any silent replay-catchup above (which only re-validates already-recorded
      // knots, not a new edit) but before this command's own structural change - see
      // pushUndoSnapshot's doc comment.
      this.pushUndoSnapshot();

      // Re-running the same command from the same knot reuses the existing child (updating its
      // response - unblessed unless the new text happens to match what's already blessed there,
      // per computeKnotState's own text-equality check) rather than creating a duplicate knot.
      const existingChildId = this.tree.findChildId(parentId, command);
      let activeKnotId: number;
      if (existingChildId !== null) {
        this.tree = this.tree.updateKnotResponse(existingChildId, newResponse);
        activeKnotId = existingChildId;
      } else {
        this.tree = this.tree.addChild(parentId, command, newResponse);
        // addChild always makes the new knot its parent's selectedChild, so this is the id we
        // just created without needing addChild to hand it back explicitly.
        activeKnotId = this.tree.getDerivedKnot(parentId)!.selectedChild!;
      }
      // selectKnot, not setActiveKnotId: the reused-existing-child branch above can land on a
      // sibling that wasn't already parentId's selectedChild (re-running an old, currently-
      // unselected command), which needs the same selectedChild fix-up a plain click does - see
      // selectKnot's doc comment in tree.ts.
      this.tree = this.tree.selectKnot(activeKnotId);
      this.processPositionId = activeKnotId;

      await this.refreshDynamicState();

      console.log(`Command "${command}" executed successfully`);
      this.changeEmitter.emit('change');
    } catch (error) {
      console.error('Failed to execute command:', error);
      throw error;
    }
  }

  /**
   * The bare replay primitive: resends every command from root to targetId in order against an
   * already-started process, recording each step's response - which also re-validates it (a
   * replayed response that no longer matches what's blessed there flips the knot to 'error',
   * catching source edits that changed earlier output). Doesn't include knot 0's banner (callers
   * capture that themselves alongside starting the process - see launchProcessAndCaptureBanner
   * for the this.process-owning case, replayAll for the independent-process one) and never
   * touches this.tree or emits anything - just returns what it found, as a plain id->Response
   * map rather than a whole tree, so replayAll's per-leaf tasks can each replay against their own
   * independent process and merge many of these afterward without any of them touching shared
   * tree state while they're still in flight.
   *
   * tree is only read here (commandPath(targetId)) - never mutated - so it's safe for several
   * concurrent calls to share the same one, as replayAll's parallel leaves do.
   *
   * When cancellation lands mid-loop, replay stops after the in-flight command's response is
   * recorded rather than mid-command (dgdebug has no way to abort a command once sent) - the
   * returned reachedId is the last knot actually replayed, not necessarily targetId, so a caller
   * that trusts it never ends up showing a response that was never actually sent to the process.
   */
  private async replayPath(
    process: SkeinProcess,
    tree: SkeinTree,
    targetId: number,
    token?: CancellationToken
  ): Promise<{ responses: Map<number, Response>; reachedId: number }> {
    const path = tree.commandPath(targetId);
    const responses = new Map<number, Response>();
    let reachedId = 0;
    for (const { id, command } of path) {
      if (token?.isCancellationRequested) {
        break;
      }
      process.sendCommand(command);
      const response = await process.readResponse();
      responses.set(id, { text: response.response, inputType: response.promptType });
      reachedId = id;
    }

    return { responses, reachedId };
  }

  /**
   * Applies a single-target replayPath to session state immediately: this is the one real
   * primitive behind Replay to Here (context menu) and runCommand's automatic catch-up when the
   * active knot isn't where the process actually is. Unlike replayAll, there's only ever one
   * path here, on this.process itself (dgdebug has no way to rewind, only restart-and-replay,
   * matching dialog-tool's own do-replay-to!), so committing this.tree/processPositionId and
   * broadcasting a single 'change' right away is both correct and cheap - and quick enough that
   * it's never worth a progress dialog (see replayAll for the one caller that wants one, and
   * that parallelizes across several processes instead of reusing this.process at all).
   */
  private async replayTo(targetId: number): Promise<void> {
    if (!this.process) {
      throw new Error('Session not running');
    }

    await this.process.terminate();
    this.tree = await this.launchProcessAndCaptureBanner(this.tree, false);

    const { responses, reachedId } = await this.replayPath(this.process, this.tree, targetId);
    let tree = this.tree;
    for (const [id, response] of responses) {
      tree = tree.updateKnotResponse(id, response);
    }

    this.tree = tree.selectKnot(reachedId);
    this.processPositionId = reachedId;
    this.closeMenus();
    await this.refreshDynamicState();
    this.changeEmitter.emit('change');
  }

  /**
   * Re-runs every command along every path in the tree - the navbar's "Replay All", implementing
   * technical-design.md's "replay all paths" (as opposed to just "replay current path"). Unlike
   * every other replay in this codebase, this doesn't restart-and-replay one path at a time on a
   * single process: each leaf gets its own independent process, and up to REPLAY_ALL_CONCURRENCY
   * of them run at once (mapWithConcurrency), matching dialog-tool's own parallel replay-all -
   * several dgdebug processes racing through their own root-to-leaf path concurrently, each
   * producing its own id->Response map, merged into one tree only once every leaf is done. Since
   * dgdebug re-reads its source files on every launch, this also doubles as picking up any edits
   * made to the project's .dg files since the process last started, across every branch, not just
   * the one visible in the transcript.
   *
   * Every leaf replays against the same base tree snapshot (baseTree, taken once up front) rather
   * than each other's results - they're independent by construction, not just by accident of
   * scheduling, so there's nothing to coordinate between them while they're in flight. Merging
   * happens once, single-threaded, after mapWithConcurrency resolves: baseTree, folded with every
   * leaf's response map in leafIds' order, except the originally-active leaf's own map goes last
   * so it wins any knot shared with another branch (there normally isn't a real difference to
   * win, since the same command against the same source should produce the same response, but
   * this keeps the outcome deterministic either way). This.tree, processPositionId, dynamic
   * state, and 'change' are all still only ever touched once, after the whole pass - see the
   * previous revision of this method for why that matters (nothing should visibly change
   * mid-replay beyond the progress bar, and nothing else on the event loop should be able to
   * observe a halfway-replayed tree).
   *
   * The originally-active leaf's own process is kept and installed as the new this.process
   * (after terminating the old one) instead of being thrown away like the others - so the live
   * process ends up exactly where that leaf's replay reached, same as before parallelizing, and
   * the very next command doesn't need yet another silent catch-up replay. This never moves the
   * active knot, though: activeKnotId and the selected spine come through baseTree untouched by
   * every updateKnotResponse fold, so replaying leaves the display exactly where the user left it
   * even though processPositionId tracks the kept process's own (possibly different) position. If
   * cancellation lands before that leaf's own task ever starts, this.process is left completely
   * untouched - only whatever other, already-finished leaves' data is kept.
   *
   * Progress is reported once per leaf's completion (in whatever order they actually finish, not
   * launch order), not once per command - a per-command report would be a broadcastScript SSE
   * write for each of potentially thousands of commands, real overhead for a progress bar nobody
   * can read that granularly anyway.
   *
   * Wrapped in progressHost.withProgress so a real session (see extension.ts's
   * vscodeProgressHost) shows a cancellable native progress notification; tests and every other
   * call site get noopProgressHost's immediate no-dialog pass-through instead.
   */
  public async replayAll(): Promise<void> {
    if (!this.process) {
      throw new Error('Session not running');
    }

    const baseTree = this.tree;
    const originalLeafId = baseTree.getSelectedLeafId();
    const leafIds = baseTree.getLeafIds();
    const totalLeaves = leafIds.length;

    await this.progressHost.withProgress({ title: 'Replaying all paths...', cancellable: true }, async (progress, token) => {
      let leavesReplayed = 0;

      const replayLeaf = async (leafId: number): Promise<LeafReplayResult | undefined> => {
        if (token.isCancellationRequested) {
          return undefined;
        }
        const process = new SkeinProcess(this.buildProcessConfig());
        await process.start();
        const banner = await process.readResponse();
        const { responses, reachedId } = await this.replayPath(process, baseTree, leafId, token);
        responses.set(0, { text: banner.response, inputType: banner.promptType });

        leavesReplayed++;
        progress.report({ message: `${leavesReplayed} of ${totalLeaves}`, increment: 100 / totalLeaves });

        return { leafId, process, responses, reachedId };
      };

      const results = (await mapWithConcurrency(leafIds, REPLAY_ALL_CONCURRENCY, replayLeaf))
        .filter((result): result is LeafReplayResult => result !== undefined);
      const originalResult = results.find((result) => result.leafId === originalLeafId);

      await Promise.all(
        results.filter((result) => result !== originalResult).map((result) => result.process.terminate())
      );

      const orderedResults = originalResult
        ? [...results.filter((result) => result !== originalResult), originalResult]
        : results;
      let tree = baseTree;
      for (const result of orderedResults) {
        for (const [id, response] of result.responses) {
          tree = tree.updateKnotResponse(id, response);
        }
      }

      if (originalResult) {
        await this.process!.terminate();
        this.process = originalResult.process;
        this.processPositionId = originalResult.reachedId;
      }
      // Not selectKnot: every updateKnotResponse fold above preserves baseTree's activeKnotId and
      // selectedChild structure untouched (only knot text/state changes), so the active knot stays
      // exactly where the user left it - replaying is a refresh, not a navigation.
      this.tree = tree;

      this.closeMenus();
      await this.refreshDynamicState();
      this.changeEmitter.emit('change');
    });
  }

  /**
   * Context menu's "Replay to Here" - the same replayTo primitive as replayAll, just targeting
   * whichever single knot the menu was opened on rather than the active spine's leaf.
   */
  public async replayToKnot(id: number): Promise<void> {
    await this.replayTo(id);
  }

  /**
   * Makes id the active (displayed/navigated-to) knot - a pure tree mutation, no process
   * interaction. Backs both graph/transcript click-navigation and the actions menu's "New
   * Child" (which then just relies on the command input + runCommand's replay-if-stale guard
   * for the actual new command). selectKnot, not the plain setActiveKnotId: clicking a knot in a
   * different branch than what's currently displayed needs to re-point the spine down to it
   * (without discarding whatever was already explored past it) - see tree.ts's selectKnot for
   * why setActiveKnotId alone isn't enough here.
   */
  public setActiveKnot(id: number): void {
    if (!this.tree.getKnot(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    this.tree = this.tree.selectKnot(id);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /**
   * Actions menu's "New Child" - makes id the active knot and clears its own selectedChild (via
   * tree.selectForNewChild), unlike setActiveKnot's selectKnot which would auto-extend into
   * whatever's already explored past id. The transcript stops exactly at id, ready for the
   * command input to create a genuinely new child, regardless of whether id already has one.
   */
  public newChild(id: number): void {
    if (!this.tree.getKnot(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    this.tree = this.tree.selectForNewChild(id);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /**
   * Opens (or, if id's menu is already open, closes - a real toggle) the tree/graph pane's
   * actions menu for id - the "..." trigger on a node. Deliberately does NOT change the active
   * knot: only a plain left-click on the knot itself (setActiveKnot) does that. Opening a menu
   * and navigating are independent actions - you can act on a knot you're not "on" without
   * disturbing where you actually are. Tracked separately from the transcript's menu (see
   * graphMenuId's doc comment) so opening one pane's menu never opens the other's.
   *
   * Toggling (rather than unconditionally setting id) matters beyond UX: the trigger's own click
   * handler posts here every time it's clicked, including the second click meant to close its
   * own menu. If that click didn't actually change graphMenuId, the re-rendered markup would be
   * byte-for-byte identical to what's already on screen, so the SSE patch would be a no-op and
   * the client-side effect that drives the popover open/closed would never re-fire - see
   * knot-menu.ts's doc comment on why that silently desyncs the popover from server state.
   */
  public openGraphMenu(id: number): void {
    if (!this.tree.getKnot(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    this.transcriptMenuId = null;
    this.graphMenuId = this.graphMenuId === id ? null : id;
    this.changeEmitter.emit('change');
  }

  /** The transcript's equivalent of openGraphMenu, including the toggle behavior - see its doc comment. */
  public openTranscriptMenu(id: number): void {
    if (!this.tree.getKnot(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    this.graphMenuId = null;
    this.transcriptMenuId = this.transcriptMenuId === id ? null : id;
    this.changeEmitter.emit('change');
  }

  /**
   * Toggles the tree/graph pane's expand/collapse state for id's subtree - the small chevron
   * below any node with children (see tree-pane.ts's renderTreeNode). Delegates entirely to
   * SkeinTree.toggleCollapsed, which also moves activeKnotId when collapsing hides it - see its
   * doc comment. Deliberately doesn't call closeMenus() (unlike every other knot action):
   * collapsing a subtree elsewhere in the tree has no bearing on a menu open on some other node.
   */
  public toggleTreeNode(id: number): void {
    this.tree = this.tree.toggleCollapsed(id);
    this.changeEmitter.emit('change');
  }

  /** Which knot has the tree/graph pane's actions menu open, if any. */
  public getGraphMenuId(): number | null {
    return this.graphMenuId;
  }

  /** Which knot has the transcript's actions menu open, if any. */
  public getTranscriptMenuId(): number | null {
    return this.transcriptMenuId;
  }

  /**
   * Closes both panes' menus - called by every mutating action (the user is done with the menu
   * once they've used it) and by plain navigation (setActiveKnot), so navigating away from a
   * knot with an open menu closes it too.
   */
  private closeMenus(): void {
    this.graphMenuId = null;
    this.transcriptMenuId = null;
  }

  /**
   * Public entry point for closing both menus without any other side effect - backs clicking
   * outside the open dropdown (native <details> has no built-in dismiss-on-outside-click the way
   * the Popover API would, so main.js's click listener calls this explicitly). A no-op (no
   * emit, no broadcast) when nothing is open, so clicks elsewhere on the page while no menu is
   * showing don't cost a wasted render.
   */
  public closeAllMenus(): void {
    if (this.graphMenuId === null && this.transcriptMenuId === null) {
      return;
    }
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Actions menu's "Bless Knot". */
  public blessKnot(id: number): void {
    this.pushUndoSnapshot();
    this.tree = this.tree.blessKnot(id);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Navbar's "Bless Changes" (the whole active spine) and, from the actions menu, a single knot's path. */
  public blessChanges(id: number): void {
    this.pushUndoSnapshot();
    this.tree = this.tree.blessTranscript(id);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Actions menu's "Toggle Lock". Root can't be locked/unlocked - mirrors app.clj's root? guard. */
  public toggleLock(id: number): void {
    if (id === 0) {
      throw new Error('The root knot cannot be locked');
    }
    const knot = this.tree.getKnot(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }
    this.pushUndoSnapshot();
    this.tree = this.tree.setLockStatus(id, !knot.locked);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Actions menu's "Edit Label...". Root's label isn't user-editable - mirrors app.clj's root? guard. */
  public setLabel(id: number, label: string | null): void {
    if (id === 0) {
      throw new Error('The root knot\'s label cannot be changed');
    }
    // Computed before pushUndoSnapshot, not after: tree.setLabel throws LabelConflictError for a
    // duplicate without touching this.tree, so a rejected label must not push a snapshot either -
    // there was no real edit to undo back to.
    const updated = this.tree.setLabel(id, label);
    this.pushUndoSnapshot();
    this.tree = updated;
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /**
   * Actions menu's "Delete". Root can't be deleted. If the active knot is id or a descendant of
   * it (about to be removed along with the rest of the subtree), moves the active knot up to id's
   * parent first, since it can no longer point at anything inside the deleted subtree.
   */
  public deleteKnot(id: number): void {
    if (id === 0) {
      throw new Error('The root knot cannot be deleted');
    }
    const knot = this.tree.getKnot(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }
    this.pushUndoSnapshot();
    if (this.isKnotOrDescendantActive(id)) {
      this.tree = this.tree.setActiveKnotId(knot.parentId);
    }
    this.tree = this.tree.deleteKnot(id);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /**
   * Actions menu's "Splice Out". Root can't be spliced. Unlike delete, only id itself goes away
   * (its children are reparented in place), so the active knot only needs reassigning when it's
   * exactly id, not when it's merely a descendant.
   */
  public spliceKnot(id: number): void {
    if (id === 0) {
      throw new Error('The root knot cannot be spliced out');
    }
    const knot = this.tree.getKnot(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }
    this.pushUndoSnapshot();
    if (this.tree.getActiveKnotId() === id) {
      this.tree = this.tree.setActiveKnotId(knot.parentId);
    }
    this.tree = this.tree.spliceKnot(id);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /**
   * Records the tree as it is right now onto the undo stack, and discards any redo history - the
   * usual rule that making a new edit after undoing invalidates whatever was undone. Called by
   * every structural edit (see this class's undo/redo doc comment on undoStack) right before it
   * starts mutating this.tree, so the snapshot is always "one edit ago", never a half-applied
   * intermediate state.
   */
  private pushUndoSnapshot(): void {
    this.undoStack.push(this.tree);
    this.redoStack = [];
  }

  /**
   * Steps the tree back to its state before the most recent structural edit (Cmd+Z). A no-op
   * when there's nothing to undo. Doesn't touch processPositionId - if the restored tree's active
   * knot no longer matches where the interpreter actually is, runCommand's own replay-if-stale
   * guard resyncs it transparently on the next command, exactly as it does for plain navigation.
   */
  public undo(): void {
    if (this.undoStack.length === 0) {
      return;
    }
    const previous = this.undoStack.pop()!;
    this.redoStack.push(this.tree);
    this.tree = previous;
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Re-applies the most recently undone edit (Shift+Cmd+Z). A no-op when there's nothing to redo. */
  public redo(): void {
    if (this.redoStack.length === 0) {
      return;
    }
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.tree);
    this.tree = next;
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Walks up from the current active knot to see if it's id itself or one of its descendants. */
  private isKnotOrDescendantActive(id: number): boolean {
    let currentId = this.tree.getActiveKnotId();
    while (currentId !== null) {
      if (currentId === id) {
        return true;
      }
      currentId = this.tree.getKnot(currentId)?.parentId ?? null;
    }
    return false;
  }

  /**
   * Notified whenever runCommand mutates the tree - the hook service.ts's SSE loop uses to know
   * when to push a fresh render to connected browsers.
   */
  public onChange(listener: () => void): void {
    this.changeEmitter.on('change', listener);
  }

  public offChange(listener: () => void): void {
    this.changeEmitter.off('change', listener);
  }

  /**
   * Re-fetches @dynamic state from the running process and diffs it against the previous
   * snapshot. dgdebug-only (per technical-design.md's Dynamic State Tracking section) - dfrotz
   * doesn't support the @dynamic command.
   */
  private async refreshDynamicState(): Promise<void> {
    if (this.config.engine !== 'dgdebug' || !this.process) {
      return;
    }

    this.process.sendCommand(DYNAMIC_COMMAND);
    const response = await this.process.readResponse();
    const newState = this.dynamicProcessor.parse(response.response);

    this.dynamicChanges = this.dynamicState ? this.dynamicProcessor.diff(this.dynamicState, newState) : null;
    this.dynamicState = newState;
  }

  /**
   * The most recently fetched dynamic state, or null if unavailable (non-dgdebug engine, or no
   * command has run yet).
   */
  public getDynamicState(): DynamicState | null {
    return this.dynamicState;
  }

  /**
   * What changed in dynamic state since the previous command, or null if there's no prior
   * snapshot to compare against.
   */
  public getDynamicChanges(): DynamicChanges | null {
    return this.dynamicChanges;
  }

  /**
   * Get the current session state
   */
  public getState(): SessionState {
    return {
      id: this.id,
      config: this.config,
      tree: this.tree,
      process: this.process,
      isRunning: this.isRunning
    };
  }

  /**
   * Stop the session and clean up resources
   */
  public async stop(): Promise<void> {
    if (this.isRunning && this.process) {
      await this.process.terminate();
      this.isRunning = false;
      console.log(`Session ${this.id} stopped`);
    }
  }

  /**
   * Get the current tree structure
   */
  public getTree(): SkeinTree {
    return this.tree;
  }

  /**
   * Where the real interpreter process currently is, as distinct from tree.getActiveKnotId()
   * (the displayed/navigated-to knot, which the user can move around freely without touching the
   * process at all). The renderer uses a mismatch here to show a "Replay to Here" prompt instead
   * of the command input - see renderCommandInput.
   */
  public getProcessPositionId(): number {
    return this.processPositionId;
  }

  /**
   * Get session ID
   */
  public getId(): string {
    return this.id;
  }

  /**
   * Check if session is running
   */
  public isRunningSession(): boolean {
    return this.isRunning;
  }
}