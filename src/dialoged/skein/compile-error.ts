/**
 * Thrown when a freshly spawned dgdebug process dies before ever delivering a real startup
 * banner. dgdebug re-parses every source file on each launch (see session.ts's
 * launchProcessAndCaptureBanner, replayAll, and traceStartup - the only three places a fresh
 * process is spawned), so this is the one moment a compile-time error in the Dialog source can
 * surface; a normal mid-session command never recompiles and so never triggers it.
 *
 * filePath/line are parsed from dgdebug's own "Error: <path>, line <N>: <message>" format (the
 * same regex as dialog-tool's source_handlers.clj/parse-error-location) - both null when the
 * abort text doesn't match that shape, e.g. an internal dgdebug error with no source location.
 */
export class DialogCompileError extends Error {
  public readonly filePath: string | null;
  public readonly line: number | null;

  constructor(rawOutput: string) {
    const plain = stripAnsi(rawOutput).trim();
    super(plain || 'dgdebug exited before starting - check the Dialog source for errors.');
    this.name = 'DialogCompileError';
    const location = parseErrorLocation(plain);
    this.filePath = location?.filePath ?? null;
    this.line = location?.line ?? null;
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

const ERROR_LOCATION_RE = /Error:\s+(.+?),\s+line\s+(\d+):/;

/**
 * Parses the "Error: <path>, line <N>: <message>" shape shared by dgdebug's startup abort text
 * and dialogc's own compile-failure output (verified directly against a real dialogc run) - null
 * when the text doesn't match, e.g. an internal error with no source location.
 */
export function parseErrorLocation(plainText: string): { filePath: string; line: number } | null {
  const match = ERROR_LOCATION_RE.exec(plainText);
  if (!match) {
    return null;
  }
  return { filePath: match[1].trim(), line: parseInt(match[2], 10) };
}
