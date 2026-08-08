/**
 * Input/Output detection for the Skein engine.
 *
 * dgdebug (with --tag-lines) and dfrotz (with -r lt) prefix every output line with a 2-
 * character tag identifying what kind of line it is - this is not a suffix-matching problem
 * on the whole response, it's a per-line protocol. See technical-design.md's "Process
 * Management" section (verified against dialog-tool's process.clj) for the full writeup this
 * implementation follows.
 */

import { EngineType } from './process';

export type PromptType = 'line' | 'key';

export interface ParsedResponse {
  content: string;
  promptType: PromptType;
}

const LINE_TAG_TERMINATOR: Record<'dgdebug' | 'dfrotz', string> = {
  dgdebug: '\n> ',
  dfrotz: '\nT > '
};
const KEYSTROKE_PREFIX = ') ';
const STARTUP_BANNER_LINE = 'Line-type display ON';
// dgdebug/dfrotz emit a redundant leading SGR reset even when it isn't needed.
const LEADING_SGR_RESET_RE = /^\x1b\[0m/;

export class IoDetector {
  private readonly family: 'dgdebug' | 'dfrotz';

  constructor(private readonly engine: EngineType) {
    // frotz and frotz-release launch dfrotz identically - see technical-design.md's Process
    // Management section - so they share the same tag family here too.
    this.family = engine === 'dgdebug' ? 'dgdebug' : 'dfrotz';
  }

  /**
   * Does the raw (untagged) accumulated buffer represent a complete response yet? Keep
   * reading from the process until this returns true.
   */
  public isComplete(buffer: string): boolean {
    if (buffer.endsWith(LINE_TAG_TERMINATOR[this.family])) {
      return true;
    }
    // Keystroke prompts don't end with a newline, so they can't be detected with a suffix
    // check on the whole buffer - only the last line matters.
    return this.lastLineOf(buffer).startsWith(KEYSTROKE_PREFIX);
  }

  /**
   * Parse a complete buffer (isComplete(buffer) must be true) into clean content and prompt
   * type: strips the interpreter's startup banner and leading blank lines, strips the 2-
   * character tag from every remaining line, and drops the residual prompt line itself.
   */
  public parse(buffer: string): ParsedResponse {
    const promptType: PromptType = this.lastLineOf(buffer).startsWith(KEYSTROKE_PREFIX) ? 'key' : 'line';

    const rawLines = buffer.replace(/\r/g, '').split('\n');

    let lines = rawLines.filter((line) => line !== STARTUP_BANNER_LINE);
    lines = dropLeading(lines, (line) => line === '');
    lines = lines.map((line) => line.slice(2));
    lines = dropLeading(lines, (line) => line === '');
    lines = dropTrailing(lines, (line) => line === '' || line === '> ');

    const content = lines.join('\n').replace(LEADING_SGR_RESET_RE, '');

    // The captured response always ends with a newline, even for a keystroke prompt that has
    // none of its own - downstream code (writing to a skein file, diffing responses) relies
    // on this being consistent.
    return { content: content.endsWith('\n') ? content : `${content}\n`, promptType };
  }

  private lastLineOf(buffer: string): string {
    const lines = buffer.split('\n');
    return lines[lines.length - 1];
  }
}

function dropLeading<T>(items: T[], predicate: (item: T) => boolean): T[] {
  let start = 0;
  while (start < items.length && predicate(items[start])) {
    start++;
  }
  return items.slice(start);
}

function dropTrailing<T>(items: T[], predicate: (item: T) => boolean): T[] {
  let end = items.length;
  while (end > 0 && predicate(items[end - 1])) {
    end--;
  }
  return items.slice(0, end);
}
