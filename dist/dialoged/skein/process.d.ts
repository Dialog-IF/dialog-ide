import { EventEmitter } from 'events';
export type EngineType = 'dgdebug' | 'frotz' | 'frotz-release';
export interface ProcessConfig {
    engine: EngineType;
    seed: number;
    gamePath: string;
    debugFlags?: string[];
}
export interface ProcessResponse {
    command: string;
    response: string;
    promptType: 'line' | 'keystroke';
    dynamic?: any;
}
export declare class SkeinProcess extends EventEmitter {
    private process;
    private config;
    private isRunning;
    constructor(config: ProcessConfig);
    start(): Promise<void>;
    private buildCommand;
    sendCommand(command: string): void;
    readResponse(): Promise<ProcessResponse>;
    terminate(): Promise<void>;
    isProcessRunning(): boolean;
}
//# sourceMappingURL=process.d.ts.map