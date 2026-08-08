export interface ProjectConfig {
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
}
export interface SkeinConfig {
    process: {
        timeout: number;
        maxRetries: number;
        env?: Record<string, string>;
    };
    tree: {
        maxKnots: number;
        memoryLimit: number;
    };
    service: {
        port: number;
        host: string;
        enableSse: boolean;
    };
    fileFormat: {
        version: string;
        encoding: 'utf8' | 'ascii';
        compression: 'none' | 'gzip';
    };
}
export declare const defaultConfig: SkeinConfig;
export declare const projectConfig: ProjectConfig;
//# sourceMappingURL=config.d.ts.map