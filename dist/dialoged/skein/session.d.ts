import { SkeinProcess, EngineType } from './process';
import { SkeinTree } from './tree';
export interface SessionConfig {
    engine: EngineType;
    seed: number;
    gamePath: string;
}
export interface SessionState {
    id: string;
    config: SessionConfig;
    tree: SkeinTree;
    process: SkeinProcess | null;
    isRunning: boolean;
}
export declare class SkeinSession {
    private id;
    private config;
    private tree;
    private process;
    private isRunning;
    constructor(config: SessionConfig);
    private generateId;
    static createNew(config: SessionConfig): SkeinSession;
    static createLoaded(tree: SkeinTree, config: SessionConfig): SkeinSession;
    start(): Promise<void>;
    runCommand(command: string): Promise<void>;
    getState(): SessionState;
    stop(): Promise<void>;
    getTree(): SkeinTree;
    getId(): string;
    isRunningSession(): boolean;
}
//# sourceMappingURL=session.d.ts.map