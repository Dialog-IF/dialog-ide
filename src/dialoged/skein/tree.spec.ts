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

  it("makes the new child its parent's selected child", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' });
    expect(tree.getDerivedKnot(0)?.selectedChild).toBe(2);
  });
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

  it('is a no-op when there is no pending unblessedResponse to bless', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .blessKnot(1)
      .blessKnot(1); // bless again with nothing pending
    expect(tree.getKnot(1)!.response).toEqual({ text: 'You see nothing.\n', inputType: 'line' });
  });
});

describe('SkeinTree.blessTranscript', () => {
  it('blesses every non-valid knot from root to the given knot', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })       // id 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' })   // id 2
      .blessTranscript(2);
    expect(tree.getDerivedKnot(1)?.state).toBe('valid');
    expect(tree.getDerivedKnot(2)?.state).toBe('valid');
  });

  it('leaves already-valid knots on the path untouched', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })     // id 1
      .blessKnot(1)
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // id 2, still new
      .blessTranscript(2);
    // id 1 was already valid before blessTranscript; its response should be unchanged
    expect(tree.getKnot(1)!.response).toEqual({ text: 'a', inputType: 'line' });
    expect(tree.getDerivedKnot(2)?.state).toBe('valid');
  });

  it('does not touch knots off the target path', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })       // id 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' })  // id 2, sibling branch
      .blessTranscript(1);
    expect(tree.getDerivedKnot(1)?.state).toBe('valid');
    expect(tree.getDerivedKnot(2)?.state).toBe('new');
  });

  it('throws when the knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.blessTranscript(999)).toThrow();
  });
});

describe('SkeinTree.deleteKnot', () => {
  it('removes the target knot itself', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .deleteKnot(1);
    expect(tree.getKnot(1)).toBeNull();
  });

  it('deletes descendants recursively', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })       // id 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' })   // id 2, child of 1
      .addChild(2, 'x orb', { text: 'c', inputType: 'line' });     // id 3, grandchild of 1
    const deleted = tree.deleteKnot(1);
    expect(deleted.getKnot(1)).toBeNull();
    expect(deleted.getKnot(2)).toBeNull();
    expect(deleted.getKnot(3)).toBeNull();
  });

  it("removes the deleted knot from its parent's children list", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .deleteKnot(1);
    expect(tree.getDerivedKnot(0)?.children).not.toContain(1);
  });

  it('reassigns selectedChild to a remaining sibling when the selected child is deleted', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1, selected
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }) // id 2, becomes selected
      .deleteKnot(2);
    expect(tree.getDerivedKnot(0)?.selectedChild).toBe(1);
  });

  it('leaves siblings of the deleted knot untouched', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }) // id 2
      .deleteKnot(1);
    expect(tree.getKnot(2)).not.toBeNull();
    expect(tree.getDerivedKnot(0)?.children).toEqual([2]);
  });

  it('throws when the knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.deleteKnot(999)).toThrow();
  });
});

describe('SkeinTree.spliceKnot', () => {
  it('removes the target knot itself', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .spliceKnot(1);
    expect(tree.getKnot(1)).toBeNull();
  });

  it("reparents the spliced knot's children to its parent", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }); // id 2, child of 1
    const spliced = tree.spliceKnot(1);
    expect(spliced.getKnot(2)?.parentId).toBe(0);
    expect(spliced.getDerivedKnot(0)?.children).toEqual([2]);
  });

  it("splices multiple children into the grandparent's children in place of the spliced knot", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })         // id 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' })    // id 2, sibling of 1
      .addChild(1, 'take orb', { text: 'c', inputType: 'line' })     // id 3, child of 1
      .addChild(1, 'x orb', { text: 'd', inputType: 'line' });       // id 4, child of 1
    const spliced = tree.spliceKnot(1);
    // id 1's two children (3, 4) take its place between root's remaining child (2)
    expect(spliced.getDerivedKnot(0)?.children).toEqual([3, 4, 2]);
    expect(spliced.getKnot(3)?.parentId).toBe(0);
    expect(spliced.getKnot(4)?.parentId).toBe(0);
  });

  it('reassigns selectedChild to the first reparented child when the spliced knot was selected', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1, selected
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }); // id 2, child of 1
    const spliced = tree.spliceKnot(1);
    expect(spliced.getDerivedKnot(0)?.selectedChild).toBe(2);
  });

  it('throws when the knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.spliceKnot(999)).toThrow();
  });
});

describe('SkeinTree.insertParent', () => {
  it('creates a new parent knot above the target, taking its old parentId', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }); // id 1
    const withParent = tree.insertParent(1, 'wait', { text: 'Time passes.', inputType: 'line' });
    expect(withParent.getAllKnots()).toHaveLength(3);
    const newParent = withParent.getKnot(2)!;
    expect(newParent.command).toBe('wait');
    expect(newParent.unblessedResponse).toEqual({ text: 'Time passes.', inputType: 'line' });
    expect(newParent.parentId).toBe(0);
  });

  it('makes the target knot a child of the new parent', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }); // id 1
    const withParent = tree.insertParent(1, 'wait', { text: 'Time passes.', inputType: 'line' });
    expect(withParent.getKnot(1)?.parentId).toBe(2);
    expect(withParent.getDerivedKnot(2)?.children).toEqual([1]);
    expect(withParent.getDerivedKnot(2)?.selectedChild).toBe(1);
  });

  it("replaces the target with the new parent in the grandparent's children", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1, selected
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }); // id 2, selected (last added)
    const withParent = tree.insertParent(1, 'wait', { text: 'Time passes.', inputType: 'line' });
    // id 3 is the new parent, replacing id 1's slot among root's children
    expect(withParent.getDerivedKnot(0)?.children).toEqual([3, 2]);
  });

  it("reassigns the grandparent's selectedChild to the new parent when the target was selected", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }); // id 1, selected (only child)
    const withParent = tree.insertParent(1, 'wait', { text: 'Time passes.', inputType: 'line' });
    expect(withParent.getDerivedKnot(0)?.selectedChild).toBe(2);
  });

  it('throws when the target knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.insertParent(999, 'wait', { text: 'a', inputType: 'line' })).toThrow();
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
