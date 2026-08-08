import { SkeinTree } from './tree';
export interface SessionFile {
    meta: {
        engine: 'dgdebug' | 'frotz' | 'frotz-release';
        seed: number;
        version: string;
        created: string;
        modified: string;
    };
    knots: Record<string, any>;
    children: Record<string, string[]>;
    selected: Record<string, string>;
    status: Record<string, 'executed' | 'pending' | 'error'>;
}
export declare class PersistenceManager {
    private basePath;
    constructor(basePath?: string);
    saveSession(tree: SkeinTree, sessionId: string): Promise<void>;
    loadSession(sessionId: string): Promise<SkeinTree>;
    atomicWrite(filePath: string, content: string): Promise<void>;
    validateSessionData(data: any): boolean;
}
//# sourceMappingURL=persistence.d.ts.map