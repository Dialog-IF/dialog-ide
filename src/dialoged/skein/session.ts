/**
 * Session management for the Skein engine.
 * Orchestrates command execution and maintains session state.
 */

import { EventEmitter } from 'events';
import { SkeinProcess, ProcessConfig, EngineType } from './process';
import { SkeinTree } from './tree';
import { DynamicProcessor, DynamicState, DynamicChanges } from './dynamic';
import { readProject, expandSources } from './project';

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

  constructor(config: SessionConfig) {
    this.id = this.generateId();
    this.config = config;
    this.tree = SkeinTree.newTree(config.engine, config.seed);
    this.dynamicProcessor = new DynamicProcessor();
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
  public static createNew(config: SessionConfig): SkeinSession {
    return new SkeinSession(config);
  }

  /**
   * Create a session from an existing tree
   */
  public static createLoaded(tree: SkeinTree, config: SessionConfig): SkeinSession {
    const session = new SkeinSession(config);
    session.tree = tree;
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
      this.process = new SkeinProcess(this.buildProcessConfig());

      await this.process.start();
      this.isRunning = true;

      // Capture the interpreter's real startup banner as knot 0's response, replacing
      // SkeinTree.newTree's generic "Welcome to the game." placeholder - io.ts's tag-line
      // parser already separates the prompt from the content, so (unlike the placeholder)
      // this doesn't carry a trailing "> " into the displayed text. updateKnotResponse only
      // ever sets the *unblessed* response, so blessKnot immediately promotes it - knot 0
      // has no prior history to diff against, it should just start out 'valid'.
      const banner = await this.process.readResponse();
      this.tree = this.tree
        .updateKnotResponse(0, { text: banner.response, inputType: banner.promptType })
        .blessKnot(0);

      console.log(`Session ${this.id} started successfully`);
      this.changeEmitter.emit('change');
    } catch (error) {
      console.error('Failed to start session:', error);
      throw error;
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

    try {
      this.process.sendCommand(command);
      const response = await this.process.readResponse();
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
      this.tree = this.tree.setActiveKnotId(activeKnotId);

      await this.refreshDynamicState();

      console.log(`Command "${command}" executed successfully`);
      this.changeEmitter.emit('change');
    } catch (error) {
      console.error('Failed to execute command:', error);
      throw error;
    }
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