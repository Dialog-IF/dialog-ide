/**
 * Input/Output detection for the Skein engine.
 * Detects and parses different types of input prompts from interpreters.
 */

/**
 * Prompt type detection
 */
export type PromptType = 'line' | 'keystroke';

/**
 * Response parsing result
 */
export interface ParseResult {
  content: string;
  promptType: PromptType;
  hasPrompt: boolean;
}

/**
 * Class for handling input/output detection
 */
export class IoDetector {
  /**
   * Detect prompt type from response content
   */
  public detectPromptType(response: string): PromptType {
    // This is a simplified implementation based on the technical specification

    // Check for dgdebug line prompts (ends with "> ")
    if (response.trim().endsWith('> ')) {
      return 'line';
    }

    // Check for dgdebug keystroke prompts (starts with ") ")
    if (response.trim().startsWith(') ')) {
      return 'keystroke';
    }

    // Check for dfrotz line prompts (starts with "\nT > " where T is text indicator)
    if (response.includes('\nT > ')) {
      return 'line';
    }

    // Check for dfrotz keystroke prompts (starts with ") ")
    if (response.trim().startsWith(') ')) {
      return 'keystroke';
    }

    // Default to line prompt if no specific pattern detected
    return 'line';
  }

  /**
   * Parse response content properly
   */
  public parseResponse(response: string): ParseResult {
    let cleanContent = response;
    let promptType: PromptType = 'line';
    let hasPrompt = false;

    // Strip prompt indicators from the output
    if (response.trim().endsWith('> ')) {
      // dgdebug line prompt
      cleanContent = response.slice(0, -2).trim();
      promptType = 'line';
      hasPrompt = true;
    } else if (response.trim().startsWith(') ')) {
      // Both interpreters keystroke prompt
      cleanContent = response.slice(2).trim();
      promptType = 'keystroke';
      hasPrompt = true;
    } else if (response.includes('\nT > ')) {
      // dfrotz line prompt - remove everything up to and including the prompt
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

  /**
   * Strip prompts from output
   */
  public stripPrompts(output: string): string {
    // Remove known prompt patterns from output
    let cleaned = output;

    // Remove dgdebug line prompts
    cleaned = cleaned.replace(/>\s*$/, '');

    // Remove dfrotz line prompts
    cleaned = cleaned.replace(/\nT > /g, '\n');

    // Remove keystroke prompts
    cleaned = cleaned.replace(/^\)\s*/, '');

    return cleaned.trim();
  }

  /**
   * Check if content contains a prompt
   */
  public hasPrompt(content: string): boolean {
    return (
      content.trim().endsWith('> ') ||
      content.trim().startsWith(') ') ||
      content.includes('\nT > ')
    );
  }
}