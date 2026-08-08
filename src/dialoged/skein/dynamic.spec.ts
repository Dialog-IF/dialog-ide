import { DynamicProcessor, DynamicKnot } from './dynamic';

function state(overrides: Partial<DynamicKnot> = {}): DynamicKnot {
  return { globals: {}, objects: {}, ...overrides };
}

describe('DynamicProcessor.extractChanges', () => {
  let processor: DynamicProcessor;

  beforeEach(() => {
    processor = new DynamicProcessor();
  });

  it('reports nothing when neither globals nor objects changed', () => {
    const before = state({ globals: { seen_orb: true } });
    const after = state({ globals: { seen_orb: true } });
    expect(processor.extractChanges(before, after)).toEqual([]);
  });

  it('reports a changed global value', () => {
    const before = state({ globals: { turns: 1 } });
    const after = state({ globals: { turns: 2 } });
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'global', name: 'turns', field: null, oldValue: 1, newValue: 2 }
    ]);
  });

  it('reports a newly-added global', () => {
    const before = state();
    const after = state({ globals: { game_started: true } });
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'global', name: 'game_started', field: null, oldValue: undefined, newValue: true }
    ]);
  });

  it('reports a removed global', () => {
    const before = state({ globals: { temp_flag: true } });
    const after = state();
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'global', name: 'temp_flag', field: null, oldValue: true, newValue: undefined }
    ]);
  });

  it('reports a newly-added object with its full value as newValue', () => {
    const before = state();
    const player = { flags: { alive: true }, properties: { location: 'forest' } };
    const after = state({ objects: { player } });
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'object', name: 'player', field: null, oldValue: undefined, newValue: player }
    ]);
  });

  it('reports a removed object with its full prior value as oldValue', () => {
    const player = { flags: { alive: true }, properties: {} };
    const before = state({ objects: { player } });
    const after = state();
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'object', name: 'player', field: null, oldValue: player, newValue: undefined }
    ]);
  });

  it('reports a changed object flag', () => {
    const before = state({ objects: { player: { flags: { alive: true }, properties: {} } } });
    const after = state({ objects: { player: { flags: { alive: false }, properties: {} } } });
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'object', name: 'player', field: 'alive', oldValue: true, newValue: false }
    ]);
  });

  it('reports a newly-added object flag', () => {
    const before = state({ objects: { player: { flags: {}, properties: {} } } });
    const after = state({ objects: { player: { flags: { poisoned: true }, properties: {} } } });
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'object', name: 'player', field: 'poisoned', oldValue: undefined, newValue: true }
    ]);
  });

  it('reports a changed object property', () => {
    const before = state({ objects: { player: { flags: {}, properties: { location: 'forest' } } } });
    const after = state({ objects: { player: { flags: {}, properties: { location: 'cave' } } } });
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'object', name: 'player', field: 'location', oldValue: 'forest', newValue: 'cave' }
    ]);
  });

  it('reports a newly-added object property', () => {
    const before = state({ objects: { player: { flags: {}, properties: {} } } });
    const after = state({ objects: { player: { flags: {}, properties: { name: 'Hero' } } } });
    expect(processor.extractChanges(before, after)).toEqual([
      { type: 'object', name: 'player', field: 'name', oldValue: undefined, newValue: 'Hero' }
    ]);
  });

  it('combines multiple simultaneous changes into one list', () => {
    const before = state({
      globals: { turns: 1 },
      objects: { player: { flags: { alive: true }, properties: {} } }
    });
    const after = state({
      globals: { turns: 2, game_over: false },
      objects: { player: { flags: { alive: true }, properties: {} }, orb: { flags: {}, properties: {} } }
    });
    const changes = processor.extractChanges(before, after);
    expect(changes).toHaveLength(3);
    expect(changes).toEqual(
      expect.arrayContaining([
        { type: 'global', name: 'turns', field: null, oldValue: 1, newValue: 2 },
        { type: 'global', name: 'game_over', field: null, oldValue: undefined, newValue: false },
        { type: 'object', name: 'orb', field: null, oldValue: undefined, newValue: { flags: {}, properties: {} } }
      ])
    );
  });
});

describe('DynamicProcessor - unimplemented parsing', () => {
  // processDynamicOutput, flattenPredicates, and handleObjectFlags are currently stubs that
  // ignore their input and return an empty/default structure regardless. These are placeholders
  // for real tests once @dynamic output parsing is actually implemented - see technical-design.md's
  // "Dynamic State Tracking" section for the expected behavior.
  test.todo('processDynamicOutput parses @dynamic output into globals/objects');
  test.todo('flattenPredicates flattens per-object predicate structures for presentation');
  test.todo('handleObjectFlags updates dynamic state for a specific object\'s flags');
});
