/**
 * Process management and I/O handling for the Skein engine.
 * Manages interaction with dgdebug and dfrotz interpreters.
 */

// Import required modules
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { IoDetector } from './io';
import { resolveCommandPath } from './project';

/**
 * Engine types supported by the Skein engine
 */
export type EngineType = 'dgdebug' | 'frotz' | 'frotz-release';

/**
 * Process configuration for interpreter launch.
 * dgdebug takes source files directly (see project.ts's expandSources), not a compiled game -
 * frotz/frotz-release take a path to an already-compiled .zblorb.
 */
export interface ProcessConfig {
  engine: EngineType;
  seed: number;
  sourceFiles?: string[];
  gamePath?: string;
  binDir?: string;
  debugFlags?: string[];
}

/**
 * Response from interpreter process
 */
export interface ProcessResponse {
  command: string;
  response: string;
  promptType: 'line' | 'key';
  dynamic?: any;
}

/**
 * Class for managing interpreter processes
 */
export class SkeinProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: ProcessConfig;
  private isRunning: boolean = false;
  private readonly ioDetector: IoDetector;
  private buffer: string = '';
  private lastCommand: string = '';
  private readonly queuedResponses: ProcessResponse[] = [];
  private readonly pendingReaders: Array<{
    resolve: (response: ProcessResponse) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(config: ProcessConfig) {
    super();
    this.config = config;
    this.ioDetector = new IoDetector(config.engine);
  }

  /**
   * Start the interpreter process with appropriate flags
   */
  public async start(): Promise<void> {
    try {
      const command = this.buildCommand();
      console.log(`Starting process: ${command.command} ${command.args.join(' ')}`);

      // Spawn the process
      this.process = spawn(command.command, command.args, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.isRunning = true;

      // Set up event listeners
      if (this.process.stdout) {
        this.process.stdout.on('data', (data) => {
          this.buffer += data.toString();
          this.emit('output', data.toString());
          this.drainCompleteResponse();
        });
      }

      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          console.error(`STDERR: ${data}`);
          this.emit('error', data.toString());
        });
      }

      this.process.on('close', (code, signal) => {
        this.isRunning = false;
        this.flushOnClose();
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
   * Checks the accumulated raw stdout buffer for a complete tag-line response (per
   * technical-design.md's Process Management section); if one is ready, parses it via
   * IoDetector and either hands it to a waiting readResponse() caller or queues it for the
   * next one.
   */
  private drainCompleteResponse(): void {
    if (!this.ioDetector.isComplete(this.buffer)) {
      return;
    }

    const parsed = this.ioDetector.parse(this.buffer);
    this.buffer = nextBufferSeed(parsed.promptType);

    const response: ProcessResponse = {
      command: this.lastCommand,
      response: parsed.content,
      promptType: parsed.promptType
    };

    this.emit('response', response);
    this.deliver(response);
  }

  private deliver(response: ProcessResponse): void {
    const reader = this.pendingReaders.shift();
    if (reader) {
      reader.resolve(response);
    } else {
      this.queuedResponses.push(response);
    }
  }

  /**
   * If the process closes with a still-pending response - either buffered raw output that
   * never reached a recognized prompt terminator, or a readResponse() caller left waiting -
   * deliver whatever was captured as a best-effort final response, mirroring dialog-tool's
   * read-loop behavior when the underlying pipe closes mid-response.
   */
  private flushOnClose(): void {
    if (this.buffer.length > 0) {
      const parsed = this.ioDetector.parse(this.buffer);
      this.buffer = '';
      this.deliver({
        command: this.lastCommand,
        response: parsed.content,
        promptType: parsed.promptType
      });
    }

    let reader = this.pendingReaders.shift();
    while (reader) {
      reader.reject(new Error('Process closed before a response was received'));
      reader = this.pendingReaders.shift();
    }
  }

  /**
   * Build the command line for starting the interpreter
   */
  private buildCommand(): { command: string, args: string[] } {
    const { engine, seed, gamePath, sourceFiles, binDir, debugFlags = [] } = this.config;

    switch (engine) {
      case 'dgdebug': {
        if (!sourceFiles || sourceFiles.length === 0) {
          throw new Error('dgdebug requires sourceFiles (see project.ts\'s expandSources)');
        }
        return {
          command: resolveCommandPath(binDir, 'dgdebug'),
          args: [
            '--numbered',
            '--seed', seed.toString(),
            '--width', '-1',
            '--unit-test',
            '--transcripting',
            '--tag-lines',
            '--formatting', 'ansi',
            ...debugFlags,
            ...sourceFiles
          ]
        };
      }

      case 'frotz':
      case 'frotz-release': {
        if (!gamePath) {
          throw new Error(`${engine} requires gamePath`);
        }
        return {
          command: resolveCommandPath(binDir, 'dfrotz'),
          args: [
            '-q', '-m', '-r', 'lt', '-f', 'normal',
            '-s', seed.toString(),
            '-w', '-1',
            gamePath
          ]
        };
      }

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

    this.lastCommand = command;
    this.process.stdin?.write(`${command}\n`);
  }

  /**
   * Read the next complete response from the process, resolving as soon as one is available -
   * immediately if a response already finished (and is queued) before this was called,
   * otherwise once the accumulating stdout buffer reaches a recognized prompt terminator.
   */
  public async readResponse(): Promise<ProcessResponse> {
    const queued = this.queuedResponses.shift();
    if (queued) {
      return queued;
    }

    if (!this.isRunning) {
      throw new Error('Process not running');
    }

    return new Promise((resolve, reject) => {
      this.pendingReaders.push({ resolve, reject });
    });
  }

  /**
   * Terminate the process gracefully - sends SIGTERM and resolves as soon as the process
   * actually closes, rather than always waiting a fixed second regardless of how quickly that
   * happens. A well-behaved dgdebug/dfrotz typically exits in well under that - but every replay
   * (runCommand's silent catch-up, Replay to Here, and Replay All's once-per-leaf restart) calls
   * this first, so a fixed wait here was pure dead time, multiplied by however many restarts a
   * replay needed. The 1s timeout is now only a last-resort ceiling: if the process hasn't closed
   * by then, it's genuinely not responding to SIGTERM and gets SIGKILL'd instead.
   */
  public async terminate(): Promise<void> {
    if (!this.process || !this.isRunning) {
      return;
    }

    const proc = this.process;
    await new Promise<void>((resolve) => {
      const onClose = () => {
        clearTimeout(timer);
        resolve();
      };
      proc.once('close', onClose);
      const timer = setTimeout(() => {
        proc.off('close', onClose);
        proc.kill('SIGKILL');
        resolve();
      }, 1000);
      proc.kill('SIGTERM');
    });

    this.isRunning = false;
  }

  /**
   * Check if the process is currently running
   */
  public isProcessRunning(): boolean {
    return this.isRunning && this.process !== null;
  }
}

/**
 * What the accumulation buffer should start as right after a response is drained - mirrors
 * dialog-tool's process.clj gen-input-scanner, which reseeds its StringBuilder the same way.
 *
 * dgdebug/dfrotz's raw stream doesn't emit a fresh 2-char tag before the command echo that
 * follows a prompt - the prompt's own tag (just consumed as the tail of the response we drained)
 * effectively covers it too. Seeding with "  " (a synthetic content tag) means the next
 * response's first real line still gets correctly tag-stripped by IoDetector.parse() rather than
 * losing its own first two characters to a slice(2) that has nothing to strip. For a line prompt
 * specifically, seeding with "  > " (rather than just "  ") means the visible "> " prompt symbol
 * survives that same stripping step and appears as genuine leading content in the next response -
 * matching dialog-tool's own captured .skein fixtures (e.g. "> i\nYou have no possessions.\n").
 * A keystroke prompt doesn't carry a visible marker forward the same way.
 */
function nextBufferSeed(promptType: 'line' | 'key'): string {
  return promptType === 'line' ? '  > ' : '  ';
}