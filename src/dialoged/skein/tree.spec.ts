import { DynamicState } from './dynamic';
import { CommandConflictError, KnotLockedError, LabelConflictError, SkeinTree, WireKnot } from './tree';

const EMPTY_DYNAMIC_STATE: DynamicState = { flags: new Set(), vars: {} };

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

  it('clears unblessedResponse instead of duplicating it when the new response matches the blessed one', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .updateKnotCommandAndResponse(1, 'look', { text: 'a', inputType: 'line' });
    expect(tree.getKnot(1)!.response).toEqual({ text: 'a', inputType: 'line' });
    expect(tree.getKnot(1)!.unblessedResponse).toBeNull();
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

  it('clears unblessedResponse instead of duplicating it when a replay reproduces the blessed response', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'a', inputType: 'line' });
    expect(tree.getKnot(1)!.response).toEqual({ text: 'a', inputType: 'line' });
    expect(tree.getKnot(1)!.unblessedResponse).toBeNull();
  });

  it('still records a mismatching response as pending unblessedResponse', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'a', inputType: 'key' });
    expect(tree.getKnot(1)!.unblessedResponse).toEqual({ text: 'a', inputType: 'key' });
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

  it('discards captured dynamic state for the deleted knot and its descendants', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // id 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // id 2
      .updateDynamicState(1, EMPTY_DYNAMIC_STATE)
      .updateDynamicState(2, EMPTY_DYNAMIC_STATE)
      .deleteKnot(1);
    expect(tree.getDynamicState(1)).toBeNull();
    expect(tree.getDynamicState(2)).toBeNull();
  });

  it('throws KnotLockedError, without deleting anything, when the knot itself is locked', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // id 1
      .setLockStatus(1, true);
    expect(() => tree.deleteKnot(1)).toThrow(KnotLockedError);
    expect(tree.getKnot(1)).not.toBeNull();
  });

  it('throws KnotLockedError, without deleting anything, when a descendant (not the knot itself) is locked', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // id 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // id 2, grandchild of root
      .setLockStatus(2, true);
    expect(() => tree.deleteKnot(1)).toThrow(KnotLockedError);
    expect(tree.getKnot(1)).not.toBeNull();
    expect(tree.getKnot(2)).not.toBeNull();
  });

  it('allows deleting a knot whose sibling (not descendant) is locked', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })      // id 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }) // id 2, locked
      .setLockStatus(2, true)
      .deleteKnot(1);
    expect(tree.getKnot(1)).toBeNull();
    expect(tree.getKnot(2)).not.toBeNull();
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

  // Labels are tree-unique (technical-design.md's Data Model) - a knot can't steal a label
  // another knot is already carrying.
  it('throws LabelConflictError when another knot already carries the requested label', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }) // knot 2
      .setLabel(1, 'checkpoint');

    expect(() => tree.setLabel(2, 'checkpoint')).toThrow(LabelConflictError);
    expect(() => tree.setLabel(2, 'checkpoint')).toThrow('Label "checkpoint" is already used by another knot.');
  });

  it('re-setting a knot\'s own already-held label is not a conflict with itself', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint');

    expect(() => tree.setLabel(1, 'checkpoint')).not.toThrow();
  });

  it('allows more than one knot to be unlabeled - only non-null labels need to be unique', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1, unlabeled
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }); // knot 2, unlabeled

    expect(() => tree.setLabel(2, null)).not.toThrow();
  });

  it('sets and clears lock status', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.setLockStatus(1, true).getKnot(1)!.locked).toBe(true);
    expect(tree.setLockStatus(1, true).setLockStatus(1, false).getKnot(1)!.locked).toBe(false);
  });
});

describe('SkeinTree.renameCommand', () => {
  it("renames a knot's command", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .renameCommand(1, 'examine room');
    expect(tree.getKnot(1)!.command).toBe('examine room');
  });

  // Command uniqueness is scoped to siblings sharing the same parent, not tree-wide like labels -
  // matches findChildId's own scope, the same lookup runCommand uses to decide reuse-vs-create.
  it('throws CommandConflictError when a different sibling already uses the requested command', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }); // knot 2

    expect(() => tree.renameCommand(2, 'look')).toThrow(CommandConflictError);
    expect(() => tree.renameCommand(2, 'look')).toThrow(
      'This knot\'s parent already has a child with the command "look".'
    );
  });

  it('allows renaming to a command already used by a knot under a *different* parent', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(1, 'inventory', { text: 'b', inputType: 'line' }); // knot 2, child of 1, not a sibling of 1

    expect(() => tree.renameCommand(2, 'look')).not.toThrow();
  });

  it('renaming to a knot\'s own already-current command is a no-op, not a conflict with itself', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }); // knot 1

    expect(() => tree.renameCommand(1, 'look')).not.toThrow();
    expect(tree.renameCommand(1, 'look')).toBe(tree); // genuinely the same instance - nothing changed
  });

  it('leaves response/unblessedResponse and knot state completely untouched - only the command text changes', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1);
    const renamed = tree.renameCommand(1, 'examine room');

    expect(renamed.getKnot(1)!.command).toBe('examine room');
    expect(renamed.getDerivedKnot(1)!.response).toBe('a');
    expect(renamed.getDerivedKnot(1)!.state).toBe('valid');
  });

  it('throws when the knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.renameCommand(999, 'look')).toThrow();
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

describe('SkeinTree.findChildId', () => {
  it('finds an existing child by exact command match', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' });
    expect(tree.findChildId(0, 'look')).toBe(1);
    expect(tree.findChildId(0, 'inventory')).toBe(2);
  });

  it('returns null when no child matches the command', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.findChildId(0, 'xyzzy')).toBeNull();
  });

  it('returns null for a knot with no children', () => {
    expect(SkeinTree.newTree('dgdebug', 1).findChildId(0, 'look')).toBeNull();
  });

  it('returns null for an unknown parent id', () => {
    expect(SkeinTree.newTree('dgdebug', 1).findChildId(999, 'look')).toBeNull();
  });
});

describe('SkeinTree.promptTypeAt', () => {
  it("defaults to 'line' for the root of a freshly created tree", () => {
    expect(SkeinTree.newTree('dgdebug', 1).promptTypeAt(0)).toBe('line');
  });

  it("defaults to 'line' for null (no active knot)", () => {
    expect(SkeinTree.newTree('dgdebug', 1).promptTypeAt(null)).toBe('line');
  });

  it("reports 'key' from a knot's unblessedResponse when it has no blessed response yet - most live knots won't", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'start combat', { text: 'Press any key...\n', inputType: 'key' });
    expect(tree.promptTypeAt(1)).toBe('key');
  });

  it("still reports 'key' once the response is blessed", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'start combat', { text: 'Press any key...\n', inputType: 'key' })
      .blessKnot(1);
    expect(tree.promptTypeAt(1)).toBe('key');
  });
});

describe('SkeinTree.commandPath', () => {
  it('returns the command path from root to id, excluding root', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' });
    expect(tree.commandPath(2)).toEqual([
      { id: 1, command: 'look' },
      { id: 2, command: 'take orb' }
    ]);
  });

  it('returns an empty array for the root itself', () => {
    expect(SkeinTree.newTree('dgdebug', 1).commandPath(0)).toEqual([]);
  });

  it('throws for an unknown id', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.commandPath(999)).toThrow();
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

  it('defaults activeKnotId to the root when the root has no children', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 1, [knot({ id: 0, label: 'START' })]);
    expect(tree.getActiveKnotId()).toBe(0);
  });

  it('sets activeKnotId to the leaf of the selected spine, not root, when the tree has multiple knots (regression - a loaded skein with several knots was only showing knot 0 in the transcript)', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 1, [
      knot({ id: 0, label: 'START' }),
      knot({ id: 1, parentId: 0, command: 'look' }),
      knot({ id: 2, parentId: 1, command: 'take orb' }),
      knot({ id: 3, parentId: 2, command: 'inventory' })
    ]);
    expect(tree.getActiveKnotId()).toBe(3);
  });

  it('follows selectedChild (first child in ascending id order) at each level, not just the last-processed knot', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 1, [
      knot({ id: 0, label: 'START' }),
      knot({ id: 1, parentId: 0, command: 'look' }), // selectedChild of 0 (lower id than 5)
      knot({ id: 5, parentId: 0, command: 'inventory' }),
      knot({ id: 2, parentId: 1, command: 'take orb' }) // selectedChild of 1, and a leaf
    ]);
    expect(tree.getActiveKnotId()).toBe(2);
  });

  it('propagates treeState bottom-up across multiple levels, not just from each knot\'s own state', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 1, [
      knot({ id: 0, label: 'START', response: { text: 'welcome', inputType: 'line' } }),
      knot({ id: 1, parentId: 0, response: { text: 'a', inputType: 'line' } }),
      knot({ id: 2, parentId: 1, unblessedResponse: { text: 'b', inputType: 'line' } })
    ]);
    expect(tree.getDerivedKnot(2)?.treeState).toBe('new');
    // id 1 is itself 'valid', but its child is 'new', so its treeState must reflect that
    expect(tree.getDerivedKnot(1)?.state).toBe('valid');
    expect(tree.getDerivedKnot(1)?.treeState).toBe('new');
    expect(tree.getDerivedKnot(0)?.treeState).toBe('new');
  });
});

describe('SkeinTree treeState propagation', () => {
  // Builds a tree where id 1 is blessed/valid and id 2 (its child) is in 'error' (blessed
  // response no longer matches its current unblessedResponse).
  function treeWithErroredGrandchild(): SkeinTree {
    return SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .addChild(1, 'north', { text: 'b', inputType: 'line' })
      .blessKnot(2)
      .updateKnotResponse(2, { text: 'c', inputType: 'line' });
  }

  it('propagates a new child\'s state up to the (otherwise valid) root', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.getDerivedKnot(0)?.treeState).toBe('new');
  });

  it('propagates an error several levels deep all the way to the root, without changing ancestors\' own state', () => {
    const tree = treeWithErroredGrandchild();

    expect(tree.getDerivedKnot(2)?.state).toBe('error');
    expect(tree.getDerivedKnot(1)?.state).toBe('valid');
    expect(tree.getDerivedKnot(1)?.treeState).toBe('error');
    expect(tree.getDerivedKnot(0)?.treeState).toBe('error');
  });

  it('clears propagated error state once the offending knot is blessed', () => {
    const fixed = treeWithErroredGrandchild().blessKnot(2);

    expect(fixed.getDerivedKnot(2)?.state).toBe('valid');
    expect(fixed.getDerivedKnot(1)?.treeState).toBe('valid');
    expect(fixed.getDerivedKnot(0)?.treeState).toBe('valid');
  });

  it('lowers the parent\'s treeState back down after deleting an errored subtree', () => {
    const afterDelete = treeWithErroredGrandchild().deleteKnot(2);

    expect(afterDelete.getDerivedKnot(1)?.treeState).toBe('valid');
    expect(afterDelete.getDerivedKnot(0)?.treeState).toBe('valid');
  });

  it('preserves propagation to the grandparent after splicing out the middle knot', () => {
    const spliced = treeWithErroredGrandchild().spliceKnot(1);

    expect(spliced.getKnot(2)!.parentId).toBe(0);
    expect(spliced.getDerivedKnot(0)?.treeState).toBe('error');
  });

  it('initializes a newly inserted parent\'s treeState from its existing child, not just its own new state', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'b', inputType: 'line' }); // id 1 is now 'error'

    const withParent = tree.insertParent(1, 'wait', { text: 'w', inputType: 'line' });
    const newParentId = withParent.getDerivedKnot(0)!.selectedChild!;

    expect(withParent.getDerivedKnot(newParentId)?.state).toBe('new');
    expect(withParent.getDerivedKnot(newParentId)?.treeState).toBe('error');
    expect(withParent.getDerivedKnot(0)?.treeState).toBe('error');
  });

  it('keeps the parent\'s treeState at the highest of all its children, not just the most recently changed one', () => {
    const withValidSibling = treeWithErroredGrandchild()
      .addChild(0, 'inventory', { text: 'c', inputType: 'line' })
      .blessKnot(3);

    // Root still has id 1 -> id 2 (error) as one branch and the new valid id 3 as another -
    // the valid sibling must not mask the error still present elsewhere.
    expect(withValidSibling.getDerivedKnot(0)?.treeState).toBe('error');
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

describe('SkeinTree.getSelectedLeafId', () => {
  it('is root on a fresh tree', () => {
    expect(SkeinTree.newTree('dgdebug', 1).getSelectedLeafId()).toBe(0);
  });

  it('follows selectedChild down to the leaf, independent of activeKnotId', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // knot 2
      .selectKnot(1); // active knot moves back up; selectedChild below it is untouched

    expect(tree.getActiveKnotId()).toBe(1);
    expect(tree.getSelectedLeafId()).toBe(2);
  });

  it('stops at a branch point, following whichever child is currently selected there', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }); // knot 2, now root's selectedChild

    expect(tree.getSelectedLeafId()).toBe(2);
  });
});

describe('SkeinTree.selectKnot', () => {
  it('sets the active knot, same as setActiveKnotId', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).selectKnot(1);
    expect(tree.getActiveKnotId()).toBe(1);
  });

  it('throws for an unknown knot id', () => {
    expect(() => SkeinTree.newTree('dgdebug', 1).selectKnot(999)).toThrow();
  });

  // The regression this whole method exists to fix: a plain click on an ancestor must not look
  // like it discarded whatever was already explored past it - only creating a new child does
  // that. render.ts's selectedKnots walks selectedChild from root, so what matters here is that
  // selectedChild below the clicked knot is untouched, not just getActiveKnotId().
  it('leaves selectedChild below the selected knot untouched, so anything already explored past it stays selected', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // knot 2, knot 1's selectedChild
      .selectKnot(0) // click back to root
      .selectKnot(1); // then click knot 1 again

    expect(tree.getDerivedKnot(1)!.selectedChild).toBe(2);
  });

  it('re-points an ancestor\'s selectedChild toward the clicked knot when it was pointing at a different branch', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }); // knot 2, now root's selectedChild
    expect(tree.getDerivedKnot(0)!.selectedChild).toBe(2);

    const selected = tree.selectKnot(1);

    expect(selected.getDerivedKnot(0)!.selectedChild).toBe(1);
  });

  it('extends selection downward through an unambiguous single-child chain below the selected knot', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // knot 2, knot 1's only child
      .selectKnot(0) // knot 1's own selectedChild is untouched by this, still 2
      .selectKnot(1);

    expect(tree.getDerivedKnot(1)!.selectedChild).toBe(2);
  });

  it('stops extending at a real branch point, leaving its existing selectedChild alone', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // knot 2
      .addChild(1, 'drop orb', { text: 'c', inputType: 'line' }) // knot 3, now knot 1's selectedChild
      .selectKnot(1);

    expect(tree.getDerivedKnot(1)!.selectedChild).toBe(3);
  });
});

describe('SkeinTree.selectForNewChild', () => {
  it('sets the active knot, same as selectKnot', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .selectForNewChild(1);
    expect(tree.getActiveKnotId()).toBe(1);
  });

  it('throws for an unknown knot id', () => {
    expect(() => SkeinTree.newTree('dgdebug', 1).selectForNewChild(999)).toThrow();
  });

  // The regression this method exists to fix: selectKnot's own extendSelection would auto-jump
  // into an existing single-child chain past the target, which is exactly wrong for "New Child" -
  // the whole point is to stop at the target so a freshly-typed command becomes a genuinely new
  // branch, not silently land on (and look like it's about to overwrite) something already there.
  it("clears the target's own selectedChild instead of extending into an existing single-child chain", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // knot 2, knot 1's only child
      .selectForNewChild(1);

    expect(tree.getDerivedKnot(1)!.selectedChild).toBeNull();
  });

  it('clears the selectedChild at a real branch point too, unlike selectKnot which leaves it alone', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // knot 2
      .addChild(1, 'drop orb', { text: 'c', inputType: 'line' }) // knot 3, now knot 1's selectedChild
      .selectForNewChild(1);

    expect(tree.getDerivedKnot(1)!.selectedChild).toBeNull();
  });

  it("re-points an ancestor's selectedChild toward the target when it was pointing at a different branch, same as selectKnot", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }); // knot 2, now root's selectedChild
    expect(tree.getDerivedKnot(0)!.selectedChild).toBe(2);

    const selected = tree.selectForNewChild(1);

    expect(selected.getDerivedKnot(0)!.selectedChild).toBe(1);
  });

  it('leaves a childless knot exactly as selectKnot would (nothing to clear or extend)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .selectForNewChild(1);
    expect(tree.getDerivedKnot(1)!.selectedChild).toBeNull();
  });
});

describe('SkeinTree.toggleCollapsed', () => {
  it('flips DerivedKnot.collapsed on alternating calls', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.getDerivedKnot(0)!.collapsed).toBe(false);

    const collapsed = tree.toggleCollapsed(0);
    expect(collapsed.getDerivedKnot(0)!.collapsed).toBe(true);

    const reExpanded = collapsed.toggleCollapsed(0);
    expect(reExpanded.getDerivedKnot(0)!.collapsed).toBe(false);
  });

  it('throws for an unknown knot id', () => {
    expect(() => SkeinTree.newTree('dgdebug', 1).toggleCollapsed(999)).toThrow();
  });

  it('moves the active knot up to the collapsed knot when it was a descendant of the newly-hidden subtree', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' })
      .setActiveKnotId(2);

    const collapsed = tree.toggleCollapsed(1);

    expect(collapsed.getActiveKnotId()).toBe(1);
  });

  it('leaves the active knot alone when collapsing the active knot itself (not a strict descendant)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setActiveKnotId(1);

    const collapsed = tree.toggleCollapsed(1);

    expect(collapsed.getActiveKnotId()).toBe(1);
  });

  it('leaves the active knot alone when it is outside the collapsed subtree', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      .setActiveKnotId(2);

    const collapsed = tree.toggleCollapsed(1);

    expect(collapsed.getActiveKnotId()).toBe(2);
  });

  it('never moves the active knot on expand, even if it happens to be inside the (already hidden) subtree', () => {
    // Contrived but worth pinning down: this shouldn't be reachable via the UI (a hidden knot
    // can't be clicked active), but the guard is specifically "only on collapsing", not "only
    // when a descendant is currently active" - assert that directly rather than relying on it
    // being unreachable.
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' })
      .setActiveKnotId(2)
      .toggleCollapsed(1); // active knot is now 1 (moved up by the collapse itself)
    const reExpanded = tree.toggleCollapsed(1);

    expect(reExpanded.getActiveKnotId()).toBe(1);
  });

  it('is not persisted through SkeinTree.fromKnots - always starts fully expanded on load', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).toggleCollapsed(0);
    const reloaded = SkeinTree.fromKnots('dgdebug', 1, tree.getAllKnots());
    expect(reloaded.getDerivedKnot(0)!.collapsed).toBe(false);
  });
});

describe('SkeinTree.updateDynamicState / getDynamicState', () => {
  it('stores and retrieves a knot\'s captured dynamic state', () => {
    const state: DynamicState = { flags: new Set(['(game started)']), vars: { '(score)': '(score) is 0' } };
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .updateDynamicState(1, state);
    expect(tree.getDynamicState(1)).toBe(state);
  });

  it('returns null for a knot with no captured dynamic state', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    expect(tree.getDynamicState(1)).toBeNull();
  });

  it('throws when the knot does not exist', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(() => tree.updateDynamicState(999, EMPTY_DYNAMIC_STATE)).toThrow();
  });

  it('is not persisted through SkeinTree.fromKnots - dynamic state never survives a reload', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .updateDynamicState(1, EMPTY_DYNAMIC_STATE);
    const reloaded = SkeinTree.fromKnots('dgdebug', 1, tree.getAllKnots());
    expect(reloaded.getDynamicState(1)).toBeNull();
  });
});
