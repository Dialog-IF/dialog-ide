"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkeinSession = void 0;
const process_1 = require("./process");
const tree_1 = require("./tree");
class SkeinSession {
    constructor(config) {
        this.process = null;
        this.isRunning = false;
        this.id = this.generateId();
        this.config = config;
        this.tree = new tree_1.SkeinTree(config.engine, config.seed);
    }
    generateId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    static createNew(config) {
        return new SkeinSession(config);
    }
    static createLoaded(tree, config) {
        const session = new SkeinSession(config);
        session.tree = tree;
        return session;
    }
    async start() {
        if (this.isRunning) {
            throw new Error('Session already running');
        }
        try {
            this.process = new process_1.SkeinProcess({
                engine: this.config.engine,
                seed: this.config.seed,
                gamePath: this.config.gamePath
            });
            await this.process.start();
            this.isRunning = true;
            console.log(`Session ${this.id} started successfully`);
        }
        catch (error) {
            console.error('Failed to start session:', error);
            throw error;
        }
    }
    async runCommand(command) {
        if (!this.isRunning || !this.process) {
            throw new Error('Session not running');
        }
        try {
            this.process.sendCommand(command);
            const response = await this.process.readResponse();
            this.tree.addChild({
                command,
                response: response.response,
                promptType: response.promptType,
                dynamic: response.dynamic,
                label: null,
                unblessed: false,
                source: {
                    file: 'unknown',
                    line: 0
                },
                parentId: '0'
            });
            console.log(`Command "${command}" executed successfully`);
        }
        catch (error) {
            console.error('Failed to execute command:', error);
            throw error;
        }
    }
    getState() {
        return {
            id: this.id,
            config: this.config,
            tree: this.tree,
            process: this.process,
            isRunning: this.isRunning
        };
    }
    async stop() {
        if (this.isRunning && this.process) {
            await this.process.terminate();
            this.isRunning = false;
            console.log(`Session ${this.id} stopped`);
        }
    }
    getTree() {
        return this.tree;
    }
    getId() {
        return this.id;
    }
    isRunningSession() {
        return this.isRunning;
    }
}
exports.SkeinSession = SkeinSession;
//# sourceMappingURL=session.js.map