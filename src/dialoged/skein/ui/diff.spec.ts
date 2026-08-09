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
});
