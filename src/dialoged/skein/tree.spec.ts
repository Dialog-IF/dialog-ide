import { SkeinTree, WireKnot } from './tree';

describe('SkeinTree.newTree', () => {
  it('creates a root knot at id 0, labeled START, with no parent', () => {
    const tree = SkeinTree.newTree('dgdebug', 12345);
    const root = tree.getKnot(0)!;
    expect(root.id).toBe(0);
    expect(root.label).toBe('START');
    expect(root.parentId).toBeNull();
    expect(root.locked).toBe(false);
  });

  it('fixes engine and seed for the tree\'s lifetime', () => {
    const tree = SkeinTree.newTree('frotz-release', 777);
    expect(tree.getEngine()).toBe('frotz-release');
    expect(tree.getSeed()).toBe(777);
  });

  it('makes the root the active knot', () => {
    expect(SkeinTree.newTree('dgdebug', 1).getActiveKnotId()).toBe(0);
  });
});

describe('SkeinTree.addChild', () => {
  it('adds a knot with an unblessed response and no blessed response yet', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' });
    const knots = tree.getAllKnots();
    const added = knots.find((k) => k.parentId === 0)!;
    expect(added.command).toBe('look');
    expect(added.response).toBeNull();
    expect(added.unblessedResponse).toEqual({ text: 'You see nothing.\n', inputType: 'line' });
  });

  it('assigns sequential ids starting after the highest existing id', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' });
    expect(tree.getAllKnots().map((k) => k.id).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("adds the new knot's id to its parent's children", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.getDerivedKnot(0)?.children).toEqual([1]);
  });

  it('throws when the parent knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.addChild(999, 'look', { text: 'a', inputType: 'line' })).toThrow();
  });

  // Known gap: technical-design.md's SkeinTree Operations spec says "the new child becomes
  // the selected child of its parent," but addChild never sets KnotState.selectedChild - and
  // there's currently no public accessor for selectedChild to even assert against. test.todo
  // rather than test.failing: there's no observable behavior yet to mark as expected-to-fail.
  test.todo('makes the new child its parent\'s selected child (needs a public selectedChild accessor first)');
});

describe('SkeinTree.updateKnotCommandAndResponse', () => {
  it('updates command and unblessedResponse, leaving everything else alone', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint');
    const updated = tree.updateKnotCommandAndResponse(1, 'examine', { text: 'b', inputType: 'line' });
    const knot = updated.getKnot(1)!;
    expect(knot.command).toBe('examine');
    expect(knot.unblessedResponse).toEqual({ text: 'b', inputType: 'line' });
    expect(knot.label).toBe('checkpoint');
  });

  it('throws when the knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.updateKnotCommandAndResponse(999, 'x', { text: 'a', inputType: 'line' })).toThrow();
  });
});

describe('SkeinTree.updateKnotResponse', () => {
  it('updates unblessedResponse without touching command', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' });
    const updated = tree.updateKnotResponse(1, { text: 'b', inputType: 'line' });
    const knot = updated.getKnot(1)!;
    expect(knot.command).toBe('look');
    expect(knot.unblessedResponse).toEqual({ text: 'b', inputType: 'line' });
  });
});

describe('SkeinTree.blessKnot', () => {
  it('rolls unblessedResponse over to response and clears unblessedResponse', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .blessKnot(1);
    const knot = tree.getKnot(1)!;
    expect(knot.response).toEqual({ text: 'You see nothing.\n', inputType: 'line' });
    expect(knot.unblessedResponse).toBeNull();
  });

  it('throws when the knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.blessKnot(999)).toThrow();
  });

  // Known bug: blessKnot unconditionally does `response: knot.unblessedResponse`. Blessing an
  // already-valid knot that has no pending unblessedResponse nulls out its existing response
  // instead of being a no-op.
  test.failing('is a no-op when there is no pending unblessedResponse to bless', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .blessKnot(1)
      .blessKnot(1); // bless again with nothing pending
    expect(tree.getKnot(1)!.response).toEqual({ text: 'You see nothing.\n', inputType: 'line' });
  });
});

describe('SkeinTree.deleteKnot', () => {
  it('removes the target knot itself', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .deleteKnot(1);
    expect(tree.getKnot(1)).toBeNull();
  });

  // Known gap: the spec (and deleteKnot's own docstring) call for recursive descendant
  // deletion; the current implementation only removes the one targeted knot.
  test.failing('deletes descendants recursively', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }); // id 2, child of 1
    const deleted = tree.deleteKnot(1);
    expect(deleted.getKnot(2)).toBeNull();
  });

  // Known gap: the parent's `children` list still references the deleted id afterward.
  test.failing("removes the deleted knot from its parent's children list", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .deleteKnot(1);
    expect(tree.getDerivedKnot(0)?.children).not.toContain(1);
  });
});

describe('SkeinTree.spliceKnot', () => {
  it('removes the target knot itself', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .spliceKnot(1);
    expect(tree.getKnot(1)).toBeNull();
  });

  // Known gap: spliceKnot's contract is "reparent children to the spliced knot's parent";
  // the current implementation just deletes the knot and orphans its children.
  test.failing("reparents the spliced knot's children to its parent", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }); // id 2, child of 1
    const spliced = tree.spliceKnot(1);
    expect(spliced.getKnot(2)?.parentId).toBe(0);
  });
});

describe('SkeinTree.insertParent', () => {
  // Known gap: insertParent is currently a complete no-op stub - it returns the tree
  // unchanged rather than inserting anything.
  test.failing('creates a new parent knot above the target', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }); // id 1
    const withParent = tree.insertParent(1, 'wait', { text: 'Time passes.', inputType: 'line' });
    expect(withParent.getAllKnots()).toHaveLength(3);
  });
});

describe('SkeinTree.setLabel / setLockStatus', () => {
  it('sets and clears a label', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.setLabel(1, 'checkpoint').getKnot(1)!.label).toBe('checkpoint');
    expect(tree.setLabel(1, 'checkpoint').setLabel(1, null).getKnot(1)!.label).toBeNull();
  });

  it('sets and clears lock status', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.setLockStatus(1, true).getKnot(1)!.locked).toBe(true);
    expect(tree.setLockStatus(1, true).setLockStatus(1, false).getKnot(1)!.locked).toBe(false);
  });
});

describe('SkeinTree.getDerivedKnot', () => {
  it("is 'new' for a knot with only an unblessed response", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.getDerivedKnot(1)?.state).toBe('new');
  });

  it("is 'valid' for a blessed knot with no pending change", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1);
    expect(tree.getDerivedKnot(1)?.state).toBe('valid');
  });

  it("is 'valid' when the pending unblessed response matches the blessed one", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'a', inputType: 'line' });
    expect(tree.getDerivedKnot(1)?.state).toBe('valid');
  });

  it("is 'error' when the pending unblessed response differs from the blessed one", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'different now', inputType: 'line' });
    expect(tree.getDerivedKnot(1)?.state).toBe('error');
  });

  it('returns null for an unknown id', () => {
    expect(SkeinTree.newTree('dgdebug', 1).getDerivedKnot(999)).toBeNull();
  });
});

describe('SkeinTree.fromKnots', () => {
  function knot(overrides: Partial<WireKnot> & { id: number }): WireKnot {
    return {
      command: '',
      response: null,
      unblessedResponse: null,
      parentId: null,
      label: null,
      locked: false,
      ...overrides
    };
  }

  it('groups children by parentId', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 1, [
      knot({ id: 0, label: 'START' }),
      knot({ id: 1, parentId: 0, command: 'look' }),
      knot({ id: 2, parentId: 0, command: 'inventory' }),
      knot({ id: 3, parentId: 1, command: 'take orb' })
    ]);
    expect(tree.getDerivedKnot(0)?.children.sort()).toEqual([1, 2]);
    expect(tree.getDerivedKnot(1)?.children).toEqual([3]);
  });

  it('makes the first child in ascending id order the selectedChild', () => {
    // Deliberately out of order in the input array - fromKnots must sort by id itself.
    const tree = SkeinTree.fromKnots('dgdebug', 1, [
      knot({ id: 0, label: 'START' }),
      knot({ id: 200, parentId: 0, command: 'b' }),
      knot({ id: 100, parentId: 0, command: 'a' })
    ]);
    // No public getter for selectedChild - go through getDerivedKnot's children ordering,
    // which reflects the same ascending-id grouping fromKnots uses internally.
    expect(tree.getDerivedKnot(0)?.children).toEqual([100, 200]);
  });

  it('computes each knot\'s state the same way getDerivedKnot does', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 1, [
      knot({ id: 0, label: 'START', response: { text: 'welcome', inputType: 'line' } }),
      knot({ id: 1, parentId: 0, unblessedResponse: { text: 'new', inputType: 'line' } })
    ]);
    expect(tree.getDerivedKnot(0)?.state).toBe('valid');
    expect(tree.getDerivedKnot(1)?.state).toBe('new');
  });

  it('defaults activeKnotId to the root', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 1, [knot({ id: 0, label: 'START' })]);
    expect(tree.getActiveKnotId()).toBe(0);
  });
});

describe('SkeinTree.setActiveKnotId', () => {
  it('updates the active knot without touching tree content', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setActiveKnotId(1);
    expect(tree.getActiveKnotId()).toBe(1);
    expect(tree.getAllKnots()).toHaveLength(2);
  });
});
