"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistenceManager = void 0;
const tree_1 = require("./tree");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
class PersistenceManager {
    constructor(basePath = './sessions') {
        this.basePath = basePath;
    }
    async saveSession(tree, sessionId) {
        try {
            await promises_1.default.mkdir(this.basePath, { recursive: true });
            const sessionFile = {
                meta: tree.getMetadata(),
                knots: {},
                children: tree['children'],
                selected: tree['selected'],
                status: tree['status']
            };
            const allKnots = tree.getAllKnots();
            for (const knot of allKnots) {
                sessionFile.knots[knot.id] = {
                    id: knot.id,
                    parentId: knot.parentId,
                    command: knot.command,
                    label: knot.label,
                    response: knot.response,
                    unblessed: knot.unblessed,
                    promptType: knot.promptType,
                    dynamic: knot.dynamic,
                    source: knot.source
                };
            }
            const filePath = path_1.default.join(this.basePath, `${sessionId}.json`);
            await promises_1.default.writeFile(filePath, JSON.stringify(sessionFile, null, 2));
            console.log(`Session ${sessionId} saved successfully to ${filePath}`);
        }
        catch (error) {
            console.error('Failed to save session:', error);
            throw error;
        }
    }
    async loadSession(sessionId) {
        try {
            const filePath = path_1.default.join(this.basePath, `${sessionId}.json`);
            const fileContent = await promises_1.default.readFile(filePath, 'utf8');
            const sessionFile = JSON.parse(fileContent);
            console.log(`Session ${sessionId} loaded successfully from ${filePath}`);
            const engine = sessionFile.meta.engine || 'dgdebug';
            const seed = sessionFile.meta.seed || 12345;
            return new tree_1.SkeinTree(engine, seed);
        }
        catch (error) {
            console.error('Failed to load session:', error);
            throw error;
        }
    }
    async atomicWrite(filePath, content) {
        try {
            const tempPath = `${filePath}.tmp`;
            await promises_1.default.writeFile(tempPath, content);
            await promises_1.default.rename(tempPath, filePath);
            console.log(`Atomic write completed for ${filePath}`);
        }
        catch (error) {
            console.error('Atomic write failed:', error);
            throw error;
        }
    }
    validateSessionData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        if (!data.meta || !data.knots) {
            return false;
        }
        return true;
    }
}
exports.PersistenceManager = PersistenceManager;
//# sourceMappingURL=persistence.js.map