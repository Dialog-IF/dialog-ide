/**
 * Full-text search over the current skein tree - technical-design.md's Core Component 7,
 * exposed via the transcript's search box (see ui/render.ts's renderSearchBox and
 * service.ts's handleSearch). No external index/library: a skein tree is realistically at most a
 * few thousand knots, so a single linear pass with plain substring matching is fast enough - the
 * design doc explicitly doesn't require anything Lucene-grade for this.
 */

import { DerivedKnot, SkeinTree } from './tree';

export type SearchField = 'label' | 'response';

export interface SearchResult {
  knotId: number;
  field: SearchField;
  /** HTML-safe (escaped), plain - the context every result shows regardless of which field matched. */
  command: string;
  /** HTML-safe (escaped), plain - null when the knot has no label. */
  label: string | null;
  /** HTML-safe: already escaped, with every matched term wrapped in <mark>. */
  snippet: string;
}

export interface SearchResults {
  /** Capped at MAX_RESULTS - see searchKnots' own doc comment. */
  results: SearchResult[];
  /** Every matching (knot, field) pair, uncapped - lets the UI say "N more, refine your search". */
  totalMatches: number;
}

/**
 * However many actual results are rendered, regardless of how many knots matched - keeps a tree
 * with hundreds of matches fast and predictable to render instead of dumping an unbounded list
 * into the DOM. totalMatches (uncapped) is what tells the UI whether it was actually truncated.
 */
const MAX_RESULTS = 50;

/** Characters of surrounding context kept on each side of a snippet's first match. */
const SNIPPET_RADIUS = 60;

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * dgdebug's own output carries real ANSI SGR escape codes (--formatting ansi - see process.ts).
 * The escape byte itself renders invisibly almost everywhere, but the rest of a code like
 * "\x1b[0m" doesn't - stripped of just that one invisible byte it reads as literal, visible
 * "[0m" text, which is exactly the garbage a raw (un-stripped) response would show up as here.
 * Matches compile-error.ts's own stripAnsi (same regex, kept local rather than shared - both are
 * one-line, and this module has no other reason to depend on that one).
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * dgdebug echoes the command back as the literal start of the response it produced ("> look\n..."
 * - see process.spec.ts/dgdebug-integration.spec.ts). The UI already shows the command on its own
 * line above every result (render.ts's renderSearchResults), so leaving this in would show it
 * twice whenever the snippet happens to include the very start of the response. Root (knot 0)
 * never has this - its response is the startup banner, not the output of a real command.
 */
function stripCommandEcho(responseText: string, command: string): string {
  const echo = `> ${command}\n`;
  return responseText.startsWith(echo) ? responseText.slice(echo.length) : responseText;
}

/**
 * The text a knot's response should be searched against - whatever the user actually sees as
 * this knot's settled response: the blessed response for every knot that has one (even an
 * 'error' knot, whose unblessedResponse is just an unaccepted pending diff, not canonical text),
 * or unblessedResponse for a knot that's never been blessed at all ('new' state) - the only
 * response text such a knot has.
 */
function searchableResponseText(knot: DerivedKnot): string {
  const raw = stripAnsi(knot.state === 'new' ? knot.unblessedResponse ?? '' : knot.response);
  return stripCommandEcho(raw, knot.command);
}

/** Lowercased, non-empty, whitespace-separated search terms. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/** True when every term is a case-insensitive substring of text - AND, not OR, across terms. */
function matchesAllTerms(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wraps every case-insensitive occurrence of any term in <mark> - text must already be HTML-escaped. */
function highlightTerms(escapedText: string, terms: string[]): string {
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return escapedText.replace(pattern, '<mark class="bg-warning/60 rounded-sm px-0.5">$1</mark>');
}

/**
 * A snippet centered on the earliest-occurring term match in text (raw, not yet escaped),
 * trimmed to SNIPPET_RADIUS characters of context on each side with an ellipsis where it was cut,
 * whitespace collapsed to single spaces (knot responses carry real newlines), then escaped and
 * highlighted. Assumes text actually matches every term in terms (searchKnots only calls this
 * after matchesAllTerms already confirmed that).
 */
function buildSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let matchIndex = 0;
  let matchLength = 0;
  let earliest = Infinity;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && index < earliest) {
      earliest = index;
      matchIndex = index;
      matchLength = term.length;
    }
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const window = text.slice(start, end).replace(/\s+/g, ' ').trim();

  return prefix + highlightTerms(escapeHtml(window), terms) + suffix;
}

/**
 * Searches every knot's label and (settled - see searchableResponseText) response for text
 * containing every whitespace-separated term in query, case-insensitively. Terms are ANDed, not
 * ORed, so adding more search text only ever narrows the result set, never broadens it. A blank/
 * whitespace-only query matches nothing - there's no useful "everything" result to show (see
 * service.ts's handleSearch, which treats that the same as dismissing the search).
 */
export function searchKnots(tree: SkeinTree, query: string): SearchResults {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return { results: [], totalMatches: 0 };
  }

  const results: SearchResult[] = [];
  let totalMatches = 0;

  const record = (knot: DerivedKnot, field: SearchField, text: string): void => {
    totalMatches++;
    if (results.length < MAX_RESULTS) {
      results.push({
        knotId: knot.id,
        field,
        command: escapeHtml(knot.command),
        label: knot.label ? escapeHtml(knot.label) : null,
        snippet: buildSnippet(text, terms)
      });
    }
  };

  const ids = tree
    .getAllKnots()
    .map((knot) => knot.id)
    .sort((a, b) => a - b);

  for (const id of ids) {
    const knot = tree.getDerivedKnot(id)!;

    const label = knot.label ? stripAnsi(knot.label) : null;
    if (label && matchesAllTerms(label, terms)) {
      record(knot, 'label', label);
    }

    const responseText = searchableResponseText(knot);
    if (responseText && matchesAllTerms(responseText, terms)) {
      record(knot, 'response', responseText);
    }
  }

  return { results, totalMatches };
}
