export type PromptType = 'line' | 'keystroke';
export interface ParseResult {
    content: string;
    promptType: PromptType;
    hasPrompt: boolean;
}
export declare class IoDetector {
    detectPromptType(response: string): PromptType;
    parseResponse(response: string): ParseResult;
    stripPrompts(output: string): string;
    hasPrompt(content: string): boolean;
}
//# sourceMappingURL=io.d.ts.map