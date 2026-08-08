/**
 * Dynamic state processing for the Skein engine.
 * Parses the response to the "@dynamic" debug command into predicate flags/vars, matching
 * dialog-tool's skein/dynamic.clj (dgdebug-only; verified against its real .skein fixtures -
 * see dynamic.spec.ts).
 */

/**
 * The result of parsing @dynamic output.
 * - flags: predicates (global and per-object, with object names substituted for "$") that
 *   are currently true/on.
 * - vars: predicate pattern -> human-readable predicate string with value(s) substituted in
 *   for "$". Global vars are keyed by their raw (unflattened) pattern; per-object vars are
 *   keyed by the pattern with just the object name substituted - this asymmetry matches
 *   dialog-tool's own keying, preserved here for fidelity rather than "fixed".
 */
export interface DynamicState {
  flags: Set<string>;
  vars: Record<string, string>;
}

/**
 * The result of diffing two DynamicStates.
 */
export interface DynamicChanges {
  added: Set<string>;
  removed: Set<string>;
  changed: Set<[string, string]>;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const SECTION_HEADER_RE = /^[A-Z \-]+$/;
const FACT_VALUE_RE = /^(\(.+\))\s+(.*)$/;
const OBJECT_VALUE_RE = /^(\S+)\s+(.+)$/;

const PARENT_PATTERN = '($ has parent $)';
const RELATION_PATTERN = '($ has relation $)';
const LOCATION_PATTERN = '($ is $ $)';

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * A line ends a run of per-object flag/var values when it's missing (end of input), blank,
 * or the start of the next predicate pattern (which always begins with "(").
 */
function isSoftEnd(line: string | undefined): boolean {
  return line === undefined || line === '' || line.startsWith('(');
}

/**
 * Trims each line and glues word-wrapped continuation lines back onto the entry they wrapped
 * from. A line starting with two spaces begins a new entry (a predicate pattern, or a
 * whitespace-separated value line); a blank line or all-caps section header line stands
 * alone; anything else is a continuation of the previous entry - concatenated directly (no
 * inserted space) if the entry-so-far ends with a hyphen (a word broken across the wrap), or
 * with one inserted space otherwise (a value list wrapping mid-list).
 */
function preParse(lines: string[]): string[] {
  const result: string[] = [];
  let prior: string | null = null;

  const flush = () => {
    if (prior !== null) {
      result.push(prior);
      prior = null;
    }
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      result.push('');
    } else if (SECTION_HEADER_RE.test(line)) {
      flush();
      result.push(line);
    } else if (line.startsWith('  ')) {
      flush();
      prior = line.trim();
    } else {
      const base = prior ?? '';
      prior = base.endsWith('-') ? base + line : `${base}${base ? ' ' : ''}${line}`;
    }
  }
  flush();

  return result;
}

interface RawSections {
  globalFlags: Set<string>;
  objectFlags: Record<string, string[]>;
  globalVars: Record<string, string>;
  objectVars: Record<string, Array<[string, string]>>;
}

/**
 * Walks the four @dynamic sections in order (GLOBAL FLAGS, PER-OBJECT FLAGS,
 * GLOBAL VARIABLES, PER-OBJECT VARIABLES) over pre-parsed lines. lines[0] must already be
 * inside GLOBAL FLAGS (i.e. the command echo and the "GLOBAL FLAGS" header itself have
 * already been dropped by the caller).
 */
function parseSections(lines: string[]): RawSections {
  const globalFlags = new Set<string>();
  const objectFlags: Record<string, string[]> = {};
  const globalVars: Record<string, string> = {};
  const objectVars: Record<string, Array<[string, string]>> = {};

  let i = 0;

  while (i < lines.length && lines[i] !== 'PER-OBJECT FLAGS') {
    const line = lines[i++];
    if (line === '') continue;
    const match = FACT_VALUE_RE.exec(line);
    if (match && match[2].startsWith('on')) {
      globalFlags.add(match[1]);
    }
  }
  i++; // skip the 'PER-OBJECT FLAGS' header line

  while (i < lines.length && lines[i] !== 'GLOBAL VARIABLES') {
    const fact = lines[i++];
    if (fact === '') continue;
    if (!isSoftEnd(lines[i])) {
      objectFlags[fact] = lines[i].trim().split(/\s+/);
      i++;
    }
  }
  i++; // skip the 'GLOBAL VARIABLES' header line

  while (i < lines.length && lines[i] !== 'PER-OBJECT VARIABLES') {
    const line = lines[i++];
    if (line === '') continue;
    const match = FACT_VALUE_RE.exec(line);
    if (match && match[2] !== '<unset>') {
      globalVars[match[1]] = match[2];
    }
  }
  i++; // skip the 'PER-OBJECT VARIABLES' header line

  while (i < lines.length) {
    const fact = lines[i++];
    if (fact === '') continue;
    const values: Array<[string, string]> = [];
    while (i < lines.length && !isSoftEnd(lines[i])) {
      const match = OBJECT_VALUE_RE.exec(lines[i]);
      if (match) {
        values.push([match[1], match[2]]);
      }
      i++;
    }
    if (values.length > 0) {
      objectVars[fact] = values;
    }
  }

  return { globalFlags, objectFlags, globalVars, objectVars };
}

function flattenPred(patternName: string, value: string): string {
  return patternName.replace('$', value);
}

function flattenPredMulti(patternName: string, ...values: string[]): string {
  return values.reduce((acc, value) => flattenPred(acc, value), patternName);
}

/**
 * Turns the raw section data into the final flags/vars shape: object flags/vars get their
 * "$" placeholder(s) substituted with the actual object name(s)/value(s), and the
 * ($ has parent $) / ($ has relation $) per-object vars are merged into a synthetic
 * ($ is $ $) "location" predicate per object (relation defaults to "<unset>" when an object
 * has a parent but no recorded relation).
 */
function flattenPredicates(sections: RawSections): DynamicState {
  const { globalFlags, objectFlags, globalVars, objectVars } = sections;

  const flags = new Set<string>(globalFlags);
  for (const [pattern, objectNames] of Object.entries(objectFlags)) {
    for (const objectName of objectNames) {
      flags.add(flattenPred(pattern, objectName));
    }
  }

  const vars: Record<string, string> = {};

  for (const [pattern, value] of Object.entries(globalVars)) {
    vars[pattern] = flattenPred(pattern, value);
  }

  for (const [pattern, pairs] of Object.entries(objectVars)) {
    if (pattern === PARENT_PATTERN || pattern === RELATION_PATTERN) {
      continue; // merged into the synthetic location predicate below instead
    }
    for (const [objectName, value] of pairs) {
      vars[flattenPred(pattern, objectName)] = flattenPredMulti(pattern, objectName, value);
    }
  }

  const relationByObject = new Map<string, string>();
  for (const [objectName, relation] of objectVars[RELATION_PATTERN] ?? []) {
    relationByObject.set(objectName, relation);
  }
  for (const [objectName, parent] of objectVars[PARENT_PATTERN] ?? []) {
    const relation = relationByObject.get(objectName) ?? '<unset>';
    vars[flattenPred(LOCATION_PATTERN, objectName)] =
      flattenPredMulti(LOCATION_PATTERN, objectName, relation, parent);
  }

  return { flags, vars };
}

/**
 * Dynamic output processor: parses @dynamic responses and diffs the results.
 */
export class DynamicProcessor {
  /**
   * Parse the captured response to the "@dynamic" command into a DynamicState.
   */
  public parse(response: string): DynamicState {
    const lines = stripAnsi(response).split('\n');
    // The first line is the "> @dynamic" command echo, the second is the "GLOBAL FLAGS"
    // section header - both dropped; the rest starts already inside GLOBAL FLAGS.
    const preParsed = preParse(lines.slice(2));
    return flattenPredicates(parseSections(preParsed));
  }

  /**
   * Diff two DynamicStates (typically before/after a command), returning what flags were
   * added/removed and what vars changed value (added/removed vars are folded into the same
   * added/removed sets as flags, matching dialog-tool's diff).
   */
  public diff(before: DynamicState, after: DynamicState): DynamicChanges {
    const added = new Set<string>();
    const removed = new Set<string>();
    const changed = new Set<[string, string]>();

    for (const flag of after.flags) {
      if (!before.flags.has(flag)) {
        added.add(flag);
      }
    }
    for (const flag of before.flags) {
      if (!after.flags.has(flag)) {
        removed.add(flag);
      }
    }

    const allKeys = new Set([...Object.keys(before.vars), ...Object.keys(after.vars)]);
    for (const key of allKeys) {
      const beforeValue = before.vars[key];
      const afterValue = after.vars[key];
      if (beforeValue === afterValue) {
        continue;
      }
      if (beforeValue !== undefined && afterValue !== undefined) {
        changed.add([beforeValue, afterValue]);
      } else if (beforeValue !== undefined) {
        removed.add(beforeValue);
      } else {
        added.add(afterValue!);
      }
    }

    return { added, removed, changed };
  }
}
