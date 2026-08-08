import { IoDetector } from './io';

/**
 * Builds a synthetic tagged raw buffer the way dgdebug (--tag-lines) or dfrotz (-r lt) would
 * actually emit one: every line gets a 2-character tag prefix. contentLines are plain text
 * (tagged "  "); the buffer is terminated with the given prompt line (already including its
 * own tag).
 */
function taggedBuffer(contentLines: string[], promptLine: string): string {
  const tagged = contentLines.map((line) => `  ${line}`);
  return [...tagged, promptLine].join('\n');
}

describe('IoDetector (dgdebug)', () => {
  const detector = new IoDetector('dgdebug');

  describe('isComplete', () => {
    it('is true once the buffer ends with the line-prompt terminator "\\n> "', () => {
      const buffer = taggedBuffer(['Welcome to the game.'], '> ');
      expect(detector.isComplete(buffer)).toBe(true);
    });

    it('is false for a bare trailing "> " with no preceding newline', () => {
      // The leading newline is required - see technical-design.md's Process Management
      // section. A response that happens to contain "> " isn't a complete response.
      expect(detector.isComplete('  something > ')).toBe(false);
    });

    it('is true once the last line starts with the keystroke prefix ") "', () => {
      const buffer = taggedBuffer(['Press a key to continue.'], ') ');
      expect(detector.isComplete(buffer)).toBe(true);
    });

    it('is false while still mid-response (no recognized terminator yet)', () => {
      expect(detector.isComplete('  Welcome to the game.\n  Still going')).toBe(false);
    });
  });

  describe('parse', () => {
    it('strips the 2-character tag from every content line and the prompt line', () => {
      const buffer = taggedBuffer(['Welcome to the game.', 'You are here.'], '> ');
      const result = detector.parse(buffer);
      expect(result.content).toBe('Welcome to the game.\nYou are here.\n');
      expect(result.promptType).toBe('line');
    });

    it('reports promptType "key" for a keystroke prompt', () => {
      const buffer = taggedBuffer(['Press a key to continue.'], ') ');
      const result = detector.parse(buffer);
      expect(result.promptType).toBe('key');
    });

    it('drops leading blank lines before the first real content', () => {
      const buffer = ['', '', taggedBuffer(['Welcome.'], '> ')].join('\n');
      const result = detector.parse(buffer);
      expect(result.content).toBe('Welcome.\n');
    });

    it('drops the "Line-type display ON" startup banner line', () => {
      const buffer = ['Line-type display ON', taggedBuffer(['Welcome.'], '> ')].join('\n');
      const result = detector.parse(buffer);
      expect(result.content).toBe('Welcome.\n');
    });

    it('preserves a blank line that is part of the actual game text', () => {
      const buffer = taggedBuffer(['First paragraph.', '', 'Second paragraph.'], '> ');
      const result = detector.parse(buffer);
      expect(result.content).toBe('First paragraph.\n\nSecond paragraph.\n');
    });

    it('strips a leading redundant SGR reset sequence', () => {
      const buffer = taggedBuffer(['\x1b[0mWelcome.'], '> ');
      const result = detector.parse(buffer);
      expect(result.content).toBe('Welcome.\n');
    });

    it('guarantees a trailing newline even for a keystroke prompt with none of its own', () => {
      const buffer = taggedBuffer(['Press a key.'], ') ');
      const result = detector.parse(buffer);
      expect(result.content.endsWith('\n')).toBe(true);
    });
  });
});

describe('IoDetector (dfrotz)', () => {
  const detector = new IoDetector('frotz');

  describe('isComplete', () => {
    it('is true once the buffer ends with the line-prompt terminator "\\nT > "', () => {
      const buffer = taggedBuffer(['You are in a room.'], 'T > ');
      expect(detector.isComplete(buffer)).toBe(true);
    });

    it('is false for the dgdebug-style terminator (different engine, different tag)', () => {
      const buffer = taggedBuffer(['You are in a room.'], '> ');
      expect(detector.isComplete(buffer)).toBe(false);
    });

    it('is true once the last line starts with the keystroke prefix ") ", same as dgdebug', () => {
      const buffer = taggedBuffer(['Press a key to continue.'], ') ');
      expect(detector.isComplete(buffer)).toBe(true);
    });
  });

  describe('parse', () => {
    it('strips the tag from content and the "T " + visible "> " prompt line', () => {
      const buffer = taggedBuffer(['You are in a room.'], 'T > ');
      const result = detector.parse(buffer);
      expect(result.content).toBe('You are in a room.\n');
      expect(result.promptType).toBe('line');
    });
  });

  it('frotz and frotz-release use the same dfrotz tag family', () => {
    const buffer = taggedBuffer(['You are in a room.'], 'T > ');
    expect(new IoDetector('frotz').isComplete(buffer)).toBe(true);
    expect(new IoDetector('frotz-release').isComplete(buffer)).toBe(true);
  });
});
