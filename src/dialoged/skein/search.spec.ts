import { SkeinTree } from './tree';
import { searchKnots } from './search';

function knotIds(results: ReturnType<typeof searchKnots>['results']): number[] {
  return results.map((r) => r.knotId);
}

describe('searchKnots', () => {
  it('matches a blessed response, case-insensitively', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'A dusty room.\n', inputType: 'line' })
      .blessKnot(1);

    const { results } = searchKnots(tree, 'DUSTY');

    expect(knotIds(results)).toEqual([1]);
    expect(results[0].field).toBe('response');
  });

  // Every result carries its knot's command and label as context, regardless of which field the
  // search term actually matched - the UI always shows "> command" + label chip + the matched
  // snippet (see render.ts's renderSearchResults).
  it("carries the knot's command and label as context on every result", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'A dusty room.\n', inputType: 'line' })
      .setLabel(1, 'checkpoint');

    const { results } = searchKnots(tree, 'dusty');

    expect(results[0].command).toBe('look');
    expect(results[0].label).toBe('checkpoint');
  });

  it('is null (not the string "null") for a knot with no label', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'A dusty room.\n', inputType: 'line' });

    expect(searchKnots(tree, 'dusty').results[0].label).toBeNull();
  });

  it('HTML-escapes command and label the same way as the snippet', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, '<look>', { text: 'A dusty room.\n', inputType: 'line' })
      .setLabel(1, '<checkpoint>');

    const { results } = searchKnots(tree, 'dusty');

    expect(results[0].command).toBe('&lt;look&gt;');
    expect(results[0].label).toBe('&lt;checkpoint&gt;');
  });

  // dgdebug's real output carries ANSI SGR codes (--formatting ansi - process.ts). The escape
  // byte itself is invisible almost everywhere, but the rest of a code like "\x1b[0m" isn't -
  // left un-stripped it would show up as literal, visible "[0m" garbage in the snippet.
  it('strips ANSI escape codes from the response before matching and snippet-building', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: '\x1b[0m\x1b[1mA dusty room.\x1b[0m\n', inputType: 'line' })
      .blessKnot(1);

    const { results } = searchKnots(tree, 'dusty');

    expect(results).toHaveLength(1);
    expect(results[0].snippet).not.toContain('[0m');
    expect(results[0].snippet).not.toContain('[1m');
  });

  // dgdebug echoes the command back as the literal start of the response it produced
  // ("> look\n..."). render.ts's renderSearchResults already shows the command on its own line
  // above every result, so the snippet must not repeat it - the UI would show it twice.
  it("strips the response's own leading command echo before matching/snippet-building, so it isn't shown twice", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: '> look\nA dusty room.\n', inputType: 'line' })
      .blessKnot(1);

    const { results } = searchKnots(tree, 'dusty');

    expect(results[0].snippet).not.toContain('look');
  });

  it('still matches text that only occurs within the echoed command line itself, once stripped', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'xyzzy', { text: '> xyzzy\nNothing happens.\n', inputType: 'line' })
      .blessKnot(1);

    // "xyzzy" only appears in the echo, which is stripped - it should no longer match via response.
    expect(searchKnots(tree, 'xyzzy').results).toEqual([]);
  });

  it("does not strip anything from a knot with no matching echo (e.g. a response that doesn't start with its own command)", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'A dusty room.\n', inputType: 'line' })
      .blessKnot(1);

    expect(knotIds(searchKnots(tree, 'dusty').results)).toEqual([1]);
  });

  it('matches a label', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint');

    const { results } = searchKnots(tree, 'check');

    expect(knotIds(results)).toEqual([1]);
    expect(results[0].field).toBe('label');
  });

  it("matches a 'new' (never-blessed) knot's unblessed response - the only text it has", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'A dusty room.\n', inputType: 'line' });

    const { results } = searchKnots(tree, 'dusty');

    expect(knotIds(results)).toEqual([1]);
    expect(results[0].field).toBe('response');
  });

  // The parenthetical in the feature request: unblessed is only searched as a fallback for a
  // knot with NO blessed response at all ('new'). An 'error' knot (blessed response exists, but
  // a fresher unblessed capture differs from it) is searched on its blessed text only - the
  // pending, not-yet-accepted diff isn't what the response "is" yet.
  it("does not match an 'error' knot's pending unblessed text - only its blessed response counts", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'An empty room.\n', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'A dusty room.\n', inputType: 'line' }); // now 'error': blessed still says "empty"

    expect(tree.getDerivedKnot(1)!.state).toBe('error');
    expect(searchKnots(tree, 'dusty').results).toEqual([]);
    expect(knotIds(searchKnots(tree, 'empty').results)).toEqual([1]);
  });

  it('requires every whitespace-separated term to match (AND, not OR)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'A dusty room.\n', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'A dusty orb.\n', inputType: 'line' });

    expect(knotIds(searchKnots(tree, 'dusty').results)).toEqual([1, 2]);
    expect(knotIds(searchKnots(tree, 'dusty room').results)).toEqual([1]);
    expect(knotIds(searchKnots(tree, 'dusty orb').results)).toEqual([2]);
    expect(searchKnots(tree, 'dusty nonexistent').results).toEqual([]);
  });

  // The actual feature requirement: typing more should only ever shrink the result set.
  it('narrows (never broadens) as more search text is added', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'A dusty room with a small orb.\n', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'A dusty, empty sack.\n', inputType: 'line' })
      .addChild(0, 'wait', { text: 'Time passes quietly.\n', inputType: 'line' });

    const broad = searchKnots(tree, 'dusty');
    const narrowed = searchKnots(tree, 'dusty orb');

    expect(knotIds(broad.results)).toEqual([1, 2]);
    expect(knotIds(narrowed.results)).toEqual([1]);
    expect(narrowed.totalMatches).toBeLessThanOrEqual(broad.totalMatches);
  });

  it('returns no results for a blank or whitespace-only query', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });

    expect(searchKnots(tree, '').results).toEqual([]);
    expect(searchKnots(tree, '   ').results).toEqual([]);
  });

  it('returns results in ascending knot-id order', () => {
    let tree = SkeinTree.newTree('dgdebug', 1);
    for (let i = 0; i < 10; i++) {
      tree = tree.addChild(0, `look ${i}`, { text: `A dusty room ${i}.\n`, inputType: 'line' });
    }

    expect(knotIds(searchKnots(tree, 'dusty').results)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // "Ensure this works when there are many matches" - caps the rendered result list so a tree
  // with hundreds of matches still returns promptly and predictably, but still reports the true
  // (uncapped) count so the UI can tell the user results were actually truncated.
  it('caps results at 50 but reports the true, uncapped total match count', () => {
    let tree = SkeinTree.newTree('dgdebug', 1);
    for (let i = 0; i < 60; i++) {
      tree = tree.addChild(0, `look ${i}`, { text: `A dusty room ${i}.\n`, inputType: 'line' });
    }

    const { results, totalMatches } = searchKnots(tree, 'dusty');

    expect(results.length).toBe(50);
    expect(totalMatches).toBe(60);
    // Capped, but still the first 50 in id order, not an arbitrary/unstable subset.
    expect(knotIds(results)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('produces an HTML-escaped snippet with every matched term wrapped in <mark>', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'A <dusty> room with a dusty orb.\n', inputType: 'line' });

    const { results } = searchKnots(tree, 'dusty');

    expect(results[0].snippet).toContain('&lt;<mark class="bg-warning/60 rounded-sm px-0.5">dusty</mark>&gt;');
    // Every occurrence is highlighted, not just the first.
    expect(results[0].snippet.match(/<mark/g)?.length).toBe(2);
  });

  it('trims a long response to a window of context around the match, with an ellipsis where cut', () => {
    const filler = 'x'.repeat(200);
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: `${filler} dusty ${filler}\n`, inputType: 'line' });

    const snippet = searchKnots(tree, 'dusty').results[0].snippet;

    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(filler.length);
  });
});
