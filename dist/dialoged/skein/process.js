"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkeinProcess = void 0;
const child_process_1 = require("child_process");
const events_1 = require("events");
class SkeinProcess extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.process = null;
        this.isRunning = false;
        this.config = config;
    }
    async start() {
        try {
            const command = this.buildCommand();
            console.log(`Starting process: ${command}`);
            this.process = (0, child_process_1.spawn)(command.command, command.args, {
                cwd: process.cwd(),
                stdio: ['pipe', 'pipe', 'pipe']
            });
            this.isRunning = true;
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
        }
        catch (error) {
            console.error('Failed to start process:', error);
            throw error;
        }
    }
    buildCommand() {
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
    sendCommand(command) {
        if (!this.process || !this.isRunning) {
            throw new Error('Process not running');
        }
        const commandWithNewline = `${command}\n`;
        console.log(`Sending command: ${commandWithNewline}`);
        this.process.stdin?.write(commandWithNewline);
    }
    async readResponse() {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    command: 'test',
                    response: 'Response from interpreter',
                    promptType: 'line'
                });
            }, 100);
        });
    }
    async terminate() {
        if (this.process && this.isRunning) {
            console.log('Terminating process...');
            this.process.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.process.exitCode === null) {
                this.process.kill('SIGKILL');
            }
            this.isRunning = false;
        }
    }
    isProcessRunning() {
        return this.isRunning && this.process !== null;
    }
}
exports.SkeinProcess = SkeinProcess;
//# sourceMappingURL=process.js.map