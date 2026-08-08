/**
 * Process management and I/O handling for the Skein engine.
 * Manages interaction with dgdebug and dfrotz interpreters.
 */

// Import required modules
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Engine types supported by the Skein engine
 */
export type EngineType = 'dgdebug' | 'frotz' | 'frotz-release';

/**
 * Process configuration for interpreter launch
 */
export interface ProcessConfig {
  engine: EngineType;
  seed: number;
  gamePath: string;
  debugFlags?: string[];
}

/**
 * Response from interpreter process
 */
export interface ProcessResponse {
  command: string;
  response: string;
  promptType: 'line' | 'keystroke';
  dynamic?: any;
}

/**
 * Class for managing interpreter processes
 */
export class SkeinProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: ProcessConfig;
  private isRunning: boolean = false;

  constructor(config: ProcessConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the interpreter process with appropriate flags
   */
  public async start(): Promise<void> {
    try {
      const command = this.buildCommand();
      console.log(`Starting process: ${command}`);

      // Spawn the process
      this.process = spawn(command.command, command.args, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.isRunning = true;

      // Set up event listeners
      if (this.process.stdout) {
        this.process.stdout.on('data', (data) => {
          console.log(`STDOUT: ${data}`);
          this.emit('output', data.toString());
        });
      }

      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          console.error(`STDERR: ${data}`);
          this.emit('error', data.toString());
        });
      }

      this.process.on('close', (code, signal) => {
        console.log(`Process closed with code ${code} and signal ${signal}`);
        this.isRunning = false;
        this.emit('close', code, signal);
      });

      this.process.on('error', (error) => {
        console.error(`Process error: ${error}`);
        this.emit('error', error.message);
      });

      console.log('Process started successfully');
    } catch (error) {
      console.error('Failed to start process:', error);
      throw error;
    }
  }

  /**
   * Build the command line for starting the interpreter
   */
  private buildCommand(): { command: string, args: string[] } {
    const { engine, seed, gamePath, debugFlags = [] } = this.config;

    switch (engine) {
      case 'dgdebug':
        return {
          command: 'dgdebug',
          args: [
            '--numbered',
            '--seed', seed.toString(),
            '--width', '-1',
            '--unit-test',
            '--transcripting',
            '--tag-lines',
            '--formatting', 'ansi',
            gamePath
          ]
        };

      case 'frotz':
        return {
          command: 'dfrotz',
          args: [
            '-q', '-m', '-r', 'lt', '-f', 'normal',
            '-s', seed.toString(),
            '-w', '-1',
            gamePath
          ]
        };

      case 'frotz-release':
        return {
          command: 'dfrotz',
          args: [
            '-q', '-m', '-r', 'lt', '-f', 'normal',
            '-s', seed.toString(),
            '-w', '-1',
            gamePath
          ]
        };

      default:
        throw new Error(`Unsupported engine type: ${engine}`);
    }
  }

  /**
   * Send a command to the interpreter process
   */
  public sendCommand(command: string): void {
    if (!this.process || !this.isRunning) {
      throw new Error('Process not running');
    }

    // Add newline for command termination
    const commandWithNewline = `${command}\n`;

    console.log(`Sending command: ${commandWithNewline}`);
    this.process.stdin?.write(commandWithNewline);
  }

  /**
   * Read response from the process (simplified for now)
   */
  public async readResponse(): Promise<ProcessResponse> {
    // This is a simplified version - in a real implementation,
    // this would involve more sophisticated parsing of output streams
    return new Promise((resolve) => {
      // In a real implementation, we'd parse the actual response
      setTimeout(() => {
        resolve({
          command: 'test',
          response: 'Response from interpreter',
          promptType: 'line'
        });
      }, 100);
    });
  }

  /**
   * Terminate the process gracefully
   */
  public async terminate(): Promise<void> {
    if (this.process && this.isRunning) {
      console.log('Terminating process...');
      this.process.kill('SIGTERM');

      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (this.process.exitCode === null) {
        // Force kill if still running
        this.process.kill('SIGKILL');
      }

      this.isRunning = false;
    }
  }

  /**
   * Check if the process is currently running
   */
  public isProcessRunning(): boolean {
    return this.isRunning && this.process !== null;
  }
}