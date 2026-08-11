import { diffText } from './diff';

describe('diffText', () => {
  it('treats a null oldText as everything being added (a never-blessed knot)', () => {
    expect(diffText(null, 'You see a room.')).toEqual([{ type: 'added', value: 'You see a room.' }]);
  });

  it('returns nothing for two nulls', () => {
    expect(diffText(null, null)).toEqual([]);
  });

  it('treats a null newText as the old text shown unchanged (a settled, blessed knot)', () => {
    expect(diffText('You see a room.', null)).toEqual([{ type: 'unchanged', value: 'You see a room.' }]);
  });

  it('computes a real word-level diff when both are present', () => {
    const segments = diffText('You take the White Orb.', 'You take the Blue Orb.');
    expect(segments).toEqual([
      { type: 'unchanged', value: 'You take the ' },
      { type: 'removed', value: 'White' },
      { type: 'added', value: 'Blue' },
      { type: 'unchanged', value: ' Orb.' }
    ]);
  });

  it('returns a single unchanged segment for identical text', () => {
    expect(diffText('same text', 'same text')).toEqual([{ type: 'unchanged', value: 'same text' }]);
  });

  // Regression: diffWords (unlike diffWordsWithSpace) ignores whitespace when computing the diff,
  // so a response differing only by a trailing newline used to diff as fully 'unchanged' - hiding
  // exactly the difference that flipped the knot to 'error' in tree.ts's own strict string
  // comparison (responsesMatch). render.ts's visibleWhitespace only makes a difference visible
  // within an added/removed segment, so this has to actually be one, not folded into 'unchanged'.
  it('surfaces an extra trailing newline as an added segment, not silently as unchanged', () => {
    const segments = diffText('Room A.\n', 'Room A.\n\n');
    expect(segments).toEqual([
      { type: 'unchanged', value: 'Room A.\n' },
      { type: 'added', value: '\n' }
    ]);
  });

  it('surfaces a missing trailing newline as a removed segment', () => {
    const segments = diffText('Room A.\n\n', 'Room A.\n');
    expect(segments).toEqual([
      { type: 'unchanged', value: 'Room A.\n' },
      { type: 'removed', value: '\n' }
    ]);
  });

  it('surfaces a leading whitespace-only difference too', () => {
    const segments = diffText('Room A.', ' Room A.');
    expect(segments).toEqual([
      { type: 'added', value: ' ' },
      { type: 'unchanged', value: 'Room A.' }
    ]);
  });
});
