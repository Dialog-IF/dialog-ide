"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkeinService = void 0;
const session_1 = require("./session");
class SkeinService {
    constructor(config) {
        this.sessions = new Map();
        this.isRunning = false;
        this.config = config;
    }
    async start() {
        if (this.isRunning) {
            throw new Error('Service already running');
        }
        console.log(`Starting Skein service on ${this.config.host}:${this.config.port}`);
        this.isRunning = true;
        console.log('Skein service started successfully');
    }
    async stop() {
        if (!this.isRunning) {
            return;
        }
        for (const session of this.sessions.values()) {
            await session.stop();
        }
        this.sessions.clear();
        this.isRunning = false;
        console.log('Skein service stopped');
    }
    createSession(config) {
        const session = session_1.SkeinSession.createNew(config);
        this.sessions.set(session.getId(), session);
        return session;
    }
    loadSession(tree, config) {
        const session = session_1.SkeinSession.createLoaded(tree, config);
        this.sessions.set(session.getId(), session);
        return session;
    }
    getSession(id) {
        return this.sessions.get(id) || null;
    }
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
    async handleSkeinEndpoints() {
        console.log('Handling skein endpoints...');
    }
    serveUiComponents() {
        console.log('Serving UI components...');
    }
    sendSseUpdate(event) {
        console.log(`Sending SSE update: ${event.type}`, event.data);
    }
    isRunningService() {
        return this.isRunning;
    }
}
exports.SkeinService = SkeinService;
//# sourceMappingURL=service.js.map