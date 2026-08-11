import { DialogCompileError } from './compile-error';

// The exact bytes dgdebug --formatting ansi/--tag-lines produces for a compile error, captured
// against the real binary (tag-stripped by io.ts's parse() before it ever reaches here - see
// session.ts's throw sites): an SGR-colored "Error: <path>, line <N>: <message>" line.
const REAL_DGDEBUG_ERROR =
  '\x1b[0m\x1b[1m\x1b[36mError:\x1b[0m\x1b[36m src/orb.dg, line 25: Unterminated rule expression.\n';

describe('DialogCompileError', () => {
  it('strips ANSI SGR codes from the message', () => {
    const error = new DialogCompileError(REAL_DGDEBUG_ERROR);
    expect(error.message).toBe('Error: src/orb.dg, line 25: Unterminated rule expression.');
  });

  it('parses the file path and line number out of "Error: <path>, line <N>:"', () => {
    const error = new DialogCompileError(REAL_DGDEBUG_ERROR);
    expect(error.filePath).toBe('src/orb.dg');
    expect(error.line).toBe(25);
  });

  it('parses plain (non-ANSI) error text the same way', () => {
    const error = new DialogCompileError('Error: lib/dialog/std.dg, line 4012: Undefined predicate.\n');
    expect(error.filePath).toBe('lib/dialog/std.dg');
    expect(error.line).toBe(4012);
  });

  it('leaves filePath/line null when the text doesn\'t match dgdebug\'s error shape', () => {
    const error = new DialogCompileError('Some unrelated abort message with no location.\n');
    expect(error.filePath).toBeNull();
    expect(error.line).toBeNull();
    expect(error.message).toBe('Some unrelated abort message with no location.');
  });

  it('falls back to a generic message for empty/whitespace-only output', () => {
    const error = new DialogCompileError('   \n  ');
    expect(error.message).toBe('dgdebug exited before starting - check the Dialog source for errors.');
    expect(error.filePath).toBeNull();
  });

  it('is named DialogCompileError (not the generic "Error") for instanceof-style checks elsewhere', () => {
    const error = new DialogCompileError(REAL_DGDEBUG_ERROR);
    expect(error.name).toBe('DialogCompileError');
    expect(error).toBeInstanceOf(Error);
  });
});
