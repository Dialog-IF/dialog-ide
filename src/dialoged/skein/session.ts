/**
 * Session management for the Skein engine.
 * Orchestrates command execution and maintains session state.
 */

import { SkeinProcess, EngineType } from './process';
import { SkeinTree, WireKnot, ResponseWithInputType } from './tree';
import { DynamicProcessor, DynamicKnot } from './dynamic';

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

    try {
      // Send command to process
      this.process.sendCommand(command);

      // Read response (simplified implementation)
      const response = await this.process.readResponse();

      // Add to tree structure using proper methods
      // This is a simplified version - in practice, we'd need more sophisticated handling
      const newTree = this.tree.addChild(0, command, {
        text: response.response,
        inputType: response.promptType
      });

      this.tree = newTree;

      console.log(`Command "${command}" executed successfully`);
    } catch (error) {
      console.error('Failed to execute command:', error);
      throw error;
    }
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