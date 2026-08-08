/**
 * Session management for the Skein engine.
 * Orchestrates command execution and maintains session state.
 */

import { SkeinProcess, EngineType } from './process';
import { SkeinTree } from './tree';
import { DynamicProcessor, DynamicState, DynamicChanges } from './dynamic';

const DYNAMIC_COMMAND = '@dynamic';

/**
 * Session configuration
 */
export interface SessionConfig {
  engine: EngineType;
  seed: number;
  gamePath: string;
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
      // Create and start the process
      this.process = new SkeinProcess({
        engine: this.config.engine,
        seed: this.config.seed,
        gamePath: this.config.gamePath
      });

      await this.process.start();
      this.isRunning = true;

      // Drain the interpreter's startup output (its own initial prompt) so it doesn't sit as
      // a stale queued response ahead of the first real command's.
      await this.process.readResponse();

      console.log(`Session ${this.id} started successfully`);
    } catch (error) {
      console.error('Failed to start session:', error);
      throw error;
    }
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

      this.tree = this.tree.addChild(parentId, command, {
        text: response.response,
        inputType: response.promptType
      });

      // addChild always makes the new knot its parent's selectedChild, so this is the id we
      // just created without needing addChild to hand it back explicitly.
      const newKnotId = this.tree.getDerivedKnot(parentId)!.selectedChild!;
      this.tree = this.tree.setActiveKnotId(newKnotId);

      await this.refreshDynamicState();

      console.log(`Command "${command}" executed successfully`);
    } catch (error) {
      console.error('Failed to execute command:', error);
      throw error;
    }
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