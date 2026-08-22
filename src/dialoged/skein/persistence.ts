/**
 * Persistence layer for the Skein engine.
 *
 * Reads and writes the skein tree using dialog-tool's flat, line-oriented text format
 * (not JSON) - see technical-design.md's "Skein File Format" for the full spec. This is
 * verified against dialog-tool's skein/file.clj and real .skein fixture files, so files
 * stay interchangeable between the two tools and diff cleanly in a VCS.
 */

import { SkeinTree, WireKnot, Response, Marker, isValidMarker } from './tree';
import * as fs from 'fs/promises';
import * as path from 'path';

const KNOT_SEPARATOR = '-'.repeat(80);
const UNBLESSED_SEPARATOR = '<'.repeat(80);
const KNOT_SEPARATOR_RE = /^-{4,}$/;
const UNBLESSED_SEPARATOR_RE = /^<{4,}$/;
const KEY_VALUE_RE = /^([^:]+):\s*(.+)$/;

type EngineType = 'dgdebug' | 'frotz' | 'frotz-release';

// dialog-tool's writer emits "engine: :dgdebug" (str on a keyword) - a format its own reader
// can't actually parse back (a separate greedy-regex bug in file.clj's kv-re silently drops the
// field - see technical-design.md's File Header notes). serializeTree below deliberately doesn't
// replicate that keyword form since there's no upside to it, but this still strips a leading
// colon on read so files written by dialog-tool itself (or by earlier versions of this tool) keep
// loading correctly.
function normalizeEngine(raw: string | undefined): EngineType {
  const value = raw?.startsWith(':') ? raw.slice(1) : raw;
  if (value === 'dgdebug' || value === 'frotz' || value === 'frotz-release') {
    return value;
  }
  return 'dgdebug';
}

function parseKeyValues(block: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = KEY_VALUE_RE.exec(line);
    if (match) {
      props[match[1].trim()] = match[2];
    }
  }
  return props;
}

/**
 * Splits raw file content on knot-separator lines, keeping the (possibly multi-line) text
 * between them. Segment 0 is the header; segments alternate props/content per knot from
 * there: [header, knot0-props, knot0-content, knot1-props, knot1-content, ...].
 */
function splitOnKnotSeparator(content: string): string[] {
  const segments: string[][] = [[]];
  for (const line of content.split('\n')) {
    if (KNOT_SEPARATOR_RE.test(line)) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(line);
    }
  }
  return segments.map((lines) => lines.join('\n'));
}

/**
 * Splits a knot's content block into blessed/unblessed text on the unblessed-response
 * separator. Empty text (nothing was ever written for that part) becomes null.
 */
function splitUnblessed(content: string): { blessed: string | null; unblessed: string | null } {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => UNBLESSED_SEPARATOR_RE.test(line));
  const blessed = (index === -1 ? content : lines.slice(0, index).join('\n'));
  const unblessed = index === -1 ? null : lines.slice(index + 1).join('\n');
  return {
    blessed: blessed.length > 0 ? blessed : null,
    unblessed: unblessed && unblessed.length > 0 ? unblessed : null
  };
}

function serializeKnot(knot: WireKnot): string {
  const lines: string[] = [];
  const isRoot = knot.parentId === null;

  lines.push(KNOT_SEPARATOR);
  lines.push(`id: ${knot.id}`);
  if (knot.label !== null) {
    lines.push(`label: ${knot.label}`);
  }
  if (knot.locked) {
    lines.push('locked: true');
  }
  if (knot.marker !== null) {
    lines.push(`marker: ${knot.marker}`);
  }
  if (knot.parentId !== null) {
    lines.push(`parent-id: ${knot.parentId}`);
  }
  // The root knot has no command - it's identified by its "START" label, not a fabricated command.
  if (!isRoot) {
    lines.push(`command: ${knot.command}`);
  }
  // WireKnot tracks inputType per response; the file has one prompt field per knot, so
  // prefer the more current (unblessed) value - see technical-design.md's note on this.
  const promptSource = knot.unblessedResponse ?? knot.response;
  if (promptSource?.inputType === 'key') {
    lines.push('prompt: keystroke');
  }
  lines.push(KNOT_SEPARATOR);

  if (knot.response) {
    lines.push(knot.response.text);
  }
  if (knot.unblessedResponse) {
    lines.push(UNBLESSED_SEPARATOR);
    lines.push(knot.unblessedResponse.text);
  }

  return lines.join('\n');
}

export function serializeTree(tree: SkeinTree): string {
  const lines: string[] = [
    `seed: ${tree.getSeed()}`,
    `engine: ${tree.getEngine()}`
  ];

  const knots = tree.getAllKnots().sort((a, b) => a.id - b.id);
  for (const knot of knots) {
    lines.push(serializeKnot(knot));
  }

  // No forced trailing newline: knot content already carries whatever trailing newline(s)
  // it captured from the process, and forcing one more here would corrupt round-tripping.
  return lines.join('\n');
}

export function deserializeTree(content: string): SkeinTree {
  const segments = splitOnKnotSeparator(content);

  const header = parseKeyValues(segments[0]);
  const seed = header.seed ? parseInt(header.seed, 10) : 0;
  const engine = normalizeEngine(header.engine);

  const wireKnots: WireKnot[] = [];
  // segments[1 + 2k] is knot k's props block, segments[2 + 2k] is its content block.
  for (let i = 1; i + 1 < segments.length; i += 2) {
    const props = parseKeyValues(segments[i]);
    if (!props.id) {
      continue; // malformed block; skip rather than fail the whole load
    }

    const { blessed, unblessed } = splitUnblessed(segments[i + 1]);
    const inputType: 'line' | 'key' = props.prompt === 'keystroke' ? 'key' : 'line';
    const parentId = props['parent-id'] !== undefined ? parseInt(props['parent-id'], 10) : null;

    const toResponse = (text: string | null): Response | null =>
      text !== null ? { text, inputType } : null;
    const parsedMarker = props.marker !== undefined ? parseInt(props.marker, 10) : undefined;
    const marker: Marker | null = isValidMarker(parsedMarker) ? parsedMarker : null;

    wireKnots.push({
      id: parseInt(props.id, 10),
      command: props.command ?? (parentId === null ? 'START' : ''),
      response: toResponse(blessed),
      unblessedResponse: toResponse(unblessed),
      parentId,
      label: props.label ?? null,
      locked: props.locked === 'true',
      marker
    });
  }

  return SkeinTree.fromKnots(engine, seed, wireKnots);
}

/**
 * Persistence manager for Skein sessions
 */
export class PersistenceManager {
  private basePath: string;

  constructor(basePath: string = './sessions') {
    this.basePath = basePath;
  }

  /**
   * Save session data to file, atomically
   */
  public async saveSession(tree: SkeinTree, sessionId: string): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      const filePath = path.join(this.basePath, `${sessionId}.skein`);
      await this.atomicWrite(filePath, serializeTree(tree));

      console.log(`Session ${sessionId} saved successfully to ${filePath}`);
    } catch (error) {
      console.error('Failed to save session:', error);
      throw error;
    }
  }

  /**
   * Load session data from file
   */
  public async loadSession(sessionId: string): Promise<SkeinTree> {
    try {
      const filePath = path.join(this.basePath, `${sessionId}.skein`);
      const fileContent = await fs.readFile(filePath, 'utf8');
      const tree = deserializeTree(fileContent);

      console.log(`Session ${sessionId} loaded successfully from ${filePath}`);
      return tree;
    } catch (error) {
      console.error('Failed to load session:', error);
      throw error;
    }
  }

  /**
   * List the ids of existing sessions (".skein" files in basePath, extension stripped),
   * sorted. An absent basePath (no sessions saved yet) is a normal empty result, not an error.
   */
  public async listSessions(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.skein'))
        .map((entry) => entry.name.slice(0, -'.skein'.length))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Whether a session with the given id has already been saved.
   */
  public async sessionExists(sessionId: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.basePath, `${sessionId}.skein`));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform atomic file operations
   */
  public async atomicWrite(filePath: string, content: string): Promise<void> {
    try {
      // Create a temporary file name
      const tempPath = `${filePath}.tmp`;

      // Write to temporary file
      await fs.writeFile(tempPath, content);

      // Atomically move the temporary file to the target location
      await fs.rename(tempPath, filePath);

      console.log(`Atomic write completed for ${filePath}`);
    } catch (error) {
      console.error('Atomic write failed:', error);
      throw error;
    }
  }
}
