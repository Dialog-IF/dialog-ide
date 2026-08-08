"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IoDetector = void 0;
class IoDetector {
    detectPromptType(response) {
        if (response.trim().endsWith('> ')) {
            return 'line';
        }
        if (response.trim().startsWith(') ')) {
            return 'keystroke';
        }
        if (response.includes('\nT > ')) {
            return 'line';
        }
        if (response.trim().startsWith(') ')) {
            return 'keystroke';
        }
        return 'line';
    }
    parseResponse(response) {
        let cleanContent = response;
        let promptType = 'line';
        let hasPrompt = false;
        if (response.trim().endsWith('> ')) {
            cleanContent = response.slice(0, -2).trim();
            promptType = 'line';
            hasPrompt = true;
        }
        else if (response.trim().startsWith(') ')) {
            cleanContent = response.slice(2).trim();
            promptType = 'keystroke';
            hasPrompt = true;
        }
        else if (response.includes('\nT > ')) {
            const parts = response.split('\nT > ');
            cleanContent = parts.slice(1).join('\nT > ').trim();
            promptType = 'line';
            hasPrompt = true;
        }
        return {
            content: cleanContent,
            promptType,
            hasPrompt
        };
    }
    stripPrompts(output) {
        let cleaned = output;
        cleaned = cleaned.replace(/>\s*$/, '');
        cleaned = cleaned.replace(/\nT > /g, '\n');
        cleaned = cleaned.replace(/^\)\s*/, '');
        return cleaned.trim();
    }
    hasPrompt(content) {
        return (content.trim().endsWith('> ') ||
            content.trim().startsWith(') ') ||
            content.includes('\nT > '));
    }
}
exports.IoDetector = IoDetector;
//# sourceMappingURL=io.js.map