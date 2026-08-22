/**
 * Shared color/name lookup for the marker feature - kept out of tree.ts/persistence.ts, whose
 * Marker type and .skein serialization deal only in the bare number 1-4 (see tree.ts's Marker doc
 * comment). Used by tree-pane.ts, render.ts, and knot-menu.ts.
 */

import { Marker, ALL_MARKERS } from '../tree';

export { ALL_MARKERS };

// Tailwind's build:css scans literal class-name text in source (see CLAUDE.md) - these must be
// hardcoded strings, not built via `bg-${color}-500` interpolation, or the scanner drops them.
// Plain Tailwind palette colors, not daisyUI's semantic bg-error/bg-warning/bg-success tokens -
// those already mean knot *status* (tree-pane.ts's nodeColorClass), an unrelated concept.
export const MARKER_SWATCH_CLASS: Record<Marker, string> = {
  1: 'bg-red-500',
  2: 'bg-yellow-500',
  3: 'bg-green-500',
  4: 'bg-blue-500'
};

export const MARKER_LABEL: Record<Marker, string> = {
  1: 'Red',
  2: 'Yellow',
  3: 'Green',
  4: 'Blue'
};
