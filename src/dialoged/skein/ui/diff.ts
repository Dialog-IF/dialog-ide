/**
 * Word-level diff between a knot's blessed response and its pending unblessed one - mirrors
 * dialog-tool's diff.clj (diff-text), which uses plumula.diff (a Clojure port of Google's
 * diff-match-patch, character-level with semantic cleanup) despite the "word-level" docstring.
 * This uses the `diff` npm package's diffWords instead, which is genuinely word-tokenized and a
 * much smaller, standard dependency than porting diff-match-patch - close enough in spirit
 * (added/removed/unchanged segments) even though the exact algorithm differs.
 */

import { diffWords } from 'diff';

export type DiffSegmentType = 'added' | 'removed' | 'unchanged';

export interface DiffSegment {
  type: DiffSegmentType;
  value: string;
}

/**
 * oldText is the knot's current blessed response (null if never blessed); newText is the
 * pending unblessed one (null if there's no pending change). Matches dialog-tool's diff-text
 * exactly: a null oldText means everything in newText is new (nothing to compare against yet);
 * a null newText means just show oldText as-is; both present means a real diff.
 */
export function diffText(oldText: string | null, newText: string | null): DiffSegment[] {
  if (oldText === null) {
    return newText === null ? [] : [{ type: 'added', value: newText }];
  }
  if (newText === null) {
    return [{ type: 'unchanged', value: oldText }];
  }

  return diffWords(oldText, newText).map((part) => ({
    type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
    value: part.value
  }));
}
