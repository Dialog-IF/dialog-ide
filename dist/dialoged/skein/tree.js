"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkeinTree = void 0;
class SkeinTree {
    constructor(engine, seed) {
        this.knots = {};
        this.children = {};
        this.selected = {};
        this.status = {};
        this.metadata = {
            engine,
            seed,
            version: '1.0.0',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
        };
        const initialKnot = {
            id: '0',
            parentId: null,
            command: 'start',
            label: 'Initial state',
            response: 'Welcome to the game. > ',
            unblessed: false,
            promptType: 'line',
            dynamic: {
                globals: {},
                objects: {}
            },
            source: {
                file: 'game.dlg',
                line: 1
            }
        };
        this.knots['0'] = initialKnot;
        this.children['0'] = [];
        this.status['0'] = 'executed';
    }
    static newTree(engine, seed) {
        return new SkeinTree(engine, seed);
    }
    addChild(knotData) {
        const newId = this.generateId();
        const parentId = knotData.parentId || '0';
        if (!this.knots[parentId]) {
            throw new Error(`Parent knot ${parentId} not found`);
        }
        const newKnot = {
            id: newId,
            parentId,
            command: knotData.command,
            label: knotData.label || null,
            response: knotData.response,
            unblessed: knotData.unblessed || false,
            promptType: knotData.promptType,
            dynamic: knotData.dynamic || {
                globals: {},
                objects: {}
            },
            source: knotData.source || {
                file: 'unknown',
                line: 0
            }
        };
        this.knots[newId] = newKnot;
        this.status[newId] = 'executed';
        if (!this.children[parentId]) {
            this.children[parentId] = [];
        }
        this.children[parentId].push(newId);
        this.selected[parentId] = newId;
        console.log(`Added child knot ${newId} to parent ${parentId}`);
        return newId;
    }
    findChildId(parentId, command) {
        if (!this.children[parentId]) {
            return null;
        }
        for (const childId of this.children[parentId]) {
            if (this.knots[childId] && this.knots[childId].command === command) {
                return childId;
            }
        }
        return null;
    }
    getKnot(id) {
        return this.knots[id] || null;
    }
    getAllKnots() {
        return Object.values(this.knots);
    }
    getChildren(parentId) {
        return this.children[parentId] || [];
    }
    generateId() {
        return `knot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    getMetadata() {
        return { ...this.metadata };
    }
    updateModifiedTime() {
        this.metadata.modified = new Date().toISOString();
    }
}
exports.SkeinTree = SkeinTree;
//# sourceMappingURL=tree.js.map