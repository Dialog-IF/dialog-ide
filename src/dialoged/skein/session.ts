/**
 * Session management for the Skein engine.
 * Orchestrates command execution and maintains session state.
 */

import { EventEmitter } from 'events';
import { SkeinProcess, ProcessConfig, EngineType } from './process';
import { SkeinTree } from './tree';
import { DynamicProcessor, DynamicState, DynamicChanges } from './dynamic';
import { readProject, expandSources } from './project';
import { ProgressHost, ProgressReporter, CancellationToken, noopProgressHost } from './progress';

const DYNAMIC_COMMAND = '@dynamic';
// dialog-tool's start-debug-process! filters sources by :target :dgdebug when launching the
// debugger - not the project's configured build target (:zblorb/:aa/...) - so files suffixed
// for a specific compile target (e.g. "effects.zblorb.dg") are excluded from a dgdebug run.
const DGDEBUG_TARGET_FILTER = 'dgdebug';

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
      await this.launchProcessAndCaptureBanner(!this.hasLoadedHistory);
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
   * Spawns a fresh interpreter process and captures its startup banner as knot 0's response,
   * replacing SkeinTree.newTree's generic "Welcome to the game." placeholder - io.ts's tag-line
   * parser already separates the prompt from the content, so (unlike the placeholder) this
   * doesn't carry a trailing "> " into the displayed text. updateKnotResponse only ever sets the
   * *unblessed* response; blessRoot controls whether it's then immediately promoted (see start()'s
   * call site for when that's appropriate and when it isn't) or left for the normal diffing logic
   * to surface as a change, exactly like every other knot. Shared by start() and replayTo() -
   * replayTo always passes false, since by the time a replay runs, knot 0 already has *some* real
   * blessed response (from an earlier start()) that a changed banner should be diffed against, not
   * silently overwritten - the same re-validation every other knot on the replay path gets.
   */
  private async launchProcessAndCaptureBanner(blessRoot: boolean): Promise<void> {
    this.process = new SkeinProcess(this.buildProcessConfig());
    await this.process.start();

    const banner = await this.process.readResponse();
    this.tree = this.tree.updateKnotResponse(0, { text: banner.response, inputType: banner.promptType });
    if (blessRoot) {
      this.tree = this.tree.blessKnot(0);
    }
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
   * Restarts the interpreter process from scratch and resends every command from root to
   * targetId in order, recording each step's response via updateKnotResponse - which also
   * re-validates it (a replayed response that no longer matches what's blessed there flips the
   * knot to 'error', catching source edits that changed earlier output). This is the one real
   * primitive behind Replay All, Replay to Here (context menu), and runCommand's automatic
   * catch-up when the active knot isn't where the process actually is - dgdebug has no way to
   * rewind, only restart-and-replay, matching dialog-tool's own do-replay-to!.
   *
   * progress/token are only ever supplied by replayAll (via progressHost.withProgress) - runCommand's
   * silent catch-up and replayToKnot's single-step jump are both too quick to warrant a dialog, and
   * stay plain fire-and-forget calls. When cancellation lands mid-loop, replay stops after the
   * in-flight command's response is recorded rather than mid-command (dgdebug has no way to abort a
   * command once sent) and lands the active knot on the last knot actually replayed, not the
   * original target - a truncated-but-consistent replay, never a knot showing a response that was
   * never actually sent to the process.
   */
  private async replayTo(
    targetId: number,
    progress?: ProgressReporter,
    token?: CancellationToken
  ): Promise<void> {
    if (!this.process) {
      throw new Error('Session not running');
    }

    await this.process.terminate();
    await this.launchProcessAndCaptureBanner(false);

    const path = this.tree.commandPath(targetId);
    let reachedId = 0;
    for (const { id, command } of path) {
      if (token?.isCancellationRequested) {
        break;
      }
      progress?.report({ message: command, increment: 100 / path.length });
      this.process!.sendCommand(command);
      const response = await this.process!.readResponse();
      this.tree = this.tree.updateKnotResponse(id, { text: response.response, inputType: response.promptType });
      reachedId = id;
    }

    this.processPositionId = reachedId;
    this.tree = this.tree.selectKnot(reachedId);
    this.closeMenus();
    await this.refreshDynamicState();
    this.changeEmitter.emit('change');
  }

  /**
   * Re-runs every command on the selected spine against a fresh process - the navbar's "Replay
   * All". Targets tree.getSelectedLeafId(), not getActiveKnotId(): activeKnotId can be any knot
   * navigated to partway up the spine (see tree.ts's selectKnot), and the transcript keeps
   * showing everything past it regardless - "replay everything visible" means the leaf, not
   * wherever the user last clicked. Since dgdebug re-reads its source files on every launch, this
   * doubles as picking up any edits made to the project's .dg files since the process last
   * started. Wrapped in progressHost.withProgress so a real session (see extension.ts's
   * vscodeProgressHost) shows a cancellable native progress notification; tests and every other
   * call site get noopProgressHost's immediate no-dialog pass-through instead.
   */
  public async replayAll(): Promise<void> {
    const leafId = this.tree.getSelectedLeafId();
    await this.progressHost.withProgress({ title: 'Replaying all commands...', cancellable: true }, (progress, token) =>
      this.replayTo(leafId, progress, token)
    );
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
    this.tree = this.tree.blessKnot(id);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Navbar's "Bless Changes" (the whole active spine) and, from the actions menu, a single knot's path. */
  public blessChanges(id: number): void {
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
    this.tree = this.tree.setLockStatus(id, !knot.locked);
    this.closeMenus();
    this.changeEmitter.emit('change');
  }

  /** Actions menu's "Edit Label...". Root's label isn't user-editable - mirrors app.clj's root? guard. */
  public setLabel(id: number, label: string | null): void {
    if (id === 0) {
      throw new Error('The root knot\'s label cannot be changed');
    }
    this.tree = this.tree.setLabel(id, label);
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
    if (this.tree.getActiveKnotId() === id) {
      this.tree = this.tree.setActiveKnotId(knot.parentId);
    }
    this.tree = this.tree.spliceKnot(id);
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