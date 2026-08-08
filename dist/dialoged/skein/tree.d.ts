export interface Knot {
    id: string;
    parentId: string | null;
    command: string;
    label: string | null;
    response: string;
    unblessed: boolean;
    promptType: 'line' | 'keystroke';
    dynamic: DynamicKnot;
    source: {
        file: string;
        line: number;
    };
}
export interface DynamicKnot {
    globals: Record<string, boolean>;
    objects: Record<string, {
        flags: Record<string, boolean>;
        properties: Record<string, any>;
    }>;
    changes?: Array<{
        type: 'global' | 'object';
        name: string;
        field: string | null;
        oldValue: any;
        newValue: any;
    }>;
}
export interface TreeMetadata {
    engine: 'dgdebug' | 'frotz' | 'frotz-release';
    seed: number;
    version: string;
    created: string;
    modified: string;
}
export declare class SkeinTree {
    private metadata;
    private knots;
    private children;
    private selected;
    private status;
    constructor(engine: 'dgdebug' | 'frotz' | 'frotz-release', seed: number);
    static newTree(engine: 'dgdebug' | 'frotz' | 'frotz-release', seed: number): SkeinTree;
    addChild(knotData: Omit<Knot, 'id' | 'parentId'> & {
        parentId?: string;
    }): string;
    findChildId(parentId: string, command: string): string | null;
    getKnot(id: string): Knot | null;
    getAllKnots(): Knot[];
    getChildren(parentId: string): string[];
    private generateId;
    getMetadata(): TreeMetadata;
    updateModifiedTime(): void;
}
//# sourceMappingURL=tree.d.ts.map