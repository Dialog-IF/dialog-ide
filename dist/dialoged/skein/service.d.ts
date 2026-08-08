import { SkeinSession } from './session';
import { SkeinTree } from './tree';
export interface ServiceConfig {
    port: number;
    host: string;
}
export interface SseEvent {
    type: string;
    data: any;
}
export declare class SkeinService {
    private config;
    private sessions;
    private isRunning;
    constructor(config: ServiceConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    createSession(config: any): SkeinSession;
    loadSession(tree: SkeinTree, config: any): SkeinSession;
    getSession(id: string): SkeinSession | null;
    getAllSessions(): SkeinSession[];
    handleSkeinEndpoints(): Promise<void>;
    serveUiComponents(): void;
    sendSseUpdate(event: SseEvent): void;
    isRunningService(): boolean;
}
//# sourceMappingURL=service.d.ts.map