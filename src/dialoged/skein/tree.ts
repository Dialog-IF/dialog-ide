/**
 * Tree structure and knot management for the Skein engine.
 * Implements immutable persistent data structures as specified in the technical design.
 */

import { Map, Set } from 'immutable';
import { DynamicState } from './dynamic';

/**
 * Thrown by setLabel when the requested label is already used by a different knot - labels are
 * tree-unique (see technical-design.md's Data Model section). A distinct class, not a plain
 * Error, so callers (service.ts's handleSetLabel) can tell a rejected-but-expected conflict apart
 * from a genuine bug and respond with a message the UI can actually show the user, rather than a
 * generic 500.
 */
export class LabelConflictError extends Error {
  constructor(label: string) {
    super(`Label "${label}" is already used by another knot.`);
    this.name = 'LabelConflictError';
  }
}

/**
 * Thrown by deleteKnot when the knot being deleted, or any of its descendants, is locked (or
 * labeled - see isEffectivelyLocked) - mirrors dialog-tool's tree.clj/allow-deletion?. Deleting
 * removes the whole subtree at once, so a lock anywhere inside it (not just on the knot itself)
 * has to block the whole operation, not just that one locked knot.
 */
export class KnotLockedError extends Error {
  constructor() {
    super('Cannot delete: this knot or one of its descendants is locked or labeled.');
    this.name = 'KnotLockedError';
  }
}

/**
 * A labeled knot is treated as locked, on top of its own explicit locked flag - a label usually
 * marks a knot as a meaningful reference point (e.g. a WALKTHROUGH anchor - see
 * dialog-web-export.ts), so accidentally deleting it out from under that reference would be worse
 * than a knot losing its unblessed response. The underlying `locked` field still toggles
 * independently (Toggle Lock doesn't touch label, and vice versa); this only affects what counts
 * as "locked" for deletion, not the lock icon (tree-pane.ts/render.ts show that for the explicit
 * `locked` flag only - a label already gets its own visible chip, so a redundant lock icon isn't
 * needed to tell the user it's protected). Structurally typed so it works for both WireKnot and
 * DerivedKnot without needing two copies.
 *
 * Deliberately ignores marker: a marker is purely cosmetic (see Marker's own doc comment) and
 * must never affect deletion - don't add it here.
 */
export function isEffectivelyLocked(knot: { locked: boolean; label: string | null }): boolean {
  return knot.locked || knot.label !== null;
}

/**
 * Whether a freshly-captured response is identical to a knot's already-blessed response, in
 * which case there's nothing pending to diff or persist as unblessedResponse - see
 * responseAfterUpdate.
 */
function responsesMatch(blessed: Response | null, fresh: Response): boolean {
  return blessed !== null && blessed.text === fresh.text && blessed.inputType === fresh.inputType;
}

/**
 * What a knot's unblessedResponse should become after a fresh response comes in (replay, or a
 * command/response edit). When the fresh text matches what's already blessed there's nothing to
 * mark pending - collapsing back to null avoids a redundant duplicate that render.ts's
 * renderDiff would otherwise treat as "has a pending diff" (rendering ANSI as [B]-style markers
 * instead of real styled HTML) and that persistence.ts's serializeKnot would write to the
 * .skein file even though it never differs from the blessed response.
 */
function responseAfterUpdate(existing: WireKnot, fresh: Response): Response | null {
  return responsesMatch(existing.response, fresh) ? null : fresh;
}

/**
 * A knot's own status, or (for treeState) the greatest status among a knot and its
 * descendants. Ordering: error > new > valid.
 */
export type KnotStatus = 'new' | 'valid' | 'error';

/**
 * A purely cosmetic per-knot flag ("this needs more work") - one of four fixed colors, or none.
 * Deliberately not part of isEffectivelyLocked, unlike label - see that function's doc comment.
 * Stored as a bare number, both here and in the .skein file; color/name meaning is a UI-only
 * concern (see ui/marker-colors.ts), kept out of the data model entirely.
 */
export type Marker = 1 | 2 | 3 | 4;
export const ALL_MARKERS: readonly Marker[] = [1, 2, 3, 4];
export function isValidMarker(value: unknown): value is Marker {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * Response type with input type information
 */
export interface Response {
  text: string;
  inputType: 'line' | 'key';
}

/**
 * WireKnot - minimal data structure for persistence (read/written to files)
 */
export interface WireKnot {
  id: number;
  command: string;
  response: Response | null;
  unblessedResponse: Response | null;
  parentId: number | null;
  label: string | null;
  locked: boolean;
  marker: Marker | null;
}

/**
 * KnotState - state tracking for UI management
 */
export interface KnotState {
  state: KnotStatus;
  treeState: KnotStatus;
  selectedChild: number | null;
  children: number[];
}

/**
 * DerivedKnot - runtime data needed for UI management and state tracking
 */
export interface DerivedKnot {
  id: number;
  command: string;
  response: string;
  unblessedResponse: string | null;
  state: KnotStatus;
  treeState: KnotStatus;
  parentId: number | null;
  children: number[];
  selectedChild: number | null;
  inputType: 'line' | 'key';
  label: string | null;
  locked: boolean;
  marker: Marker | null;
  collapsed: boolean;
}

/**
 * SkeinTree - immutable persistent tree structure.
 * engine and seed are fixed for the lifetime of a tree - a skein can't change
 * which interpreter or random seed it was created with.
 */
export class SkeinTree {
  private readonly engine: 'dgdebug' | 'frotz' | 'frotz-release';
  private readonly seed: number;
  private readonly knots: Map<number, WireKnot>;
  private readonly knotStates: Map<number, KnotState>;
  private readonly activeKnotId: number | null;
  // Which knots have their tree/graph pane subtree collapsed (children hidden) - presentation
  // state only, not part of WireKnot, so it's never written to the .skein file (see fromKnots,
  // which always starts empty) and doesn't affect a knot's own state/treeState. Lives on the
  // tree itself, alongside activeKnotId, rather than as a session-level side channel, because
  // toggling it can need to move activeKnotId (see toggleCollapsed) - keeping both in one place
  // means that interaction is a single atomic tree operation instead of two systems that have to
  // be kept in sync by whoever calls them.
  private readonly collapsedKnotIds: Set<number>;
  // Per-knot @dynamic capture (SkeinSession.captureDynamicState), keyed by knot id - presentation/
  // debugging data, not part of WireKnot, so (like collapsedKnotIds) it's never written to the
  // .skein file (fromKnots always starts empty) and never persists across a reload. Lives on the
  // tree rather than as a session-level side channel so it rides along with undo/redo the same way
  // a knot's response/state does - re-running a command is a structural edit (runCommand pushes an
  // undo snapshot), and its freshly captured dynamic state should roll back with it.
  private readonly dynamicStates: Map<number, DynamicState>;

  private constructor(
    engine: 'dgdebug' | 'frotz' | 'frotz-release',
    seed: number,
    knots: Map<number, WireKnot>,
    knotStates: Map<number, KnotState>,
    activeKnotId: number | null,
    collapsedKnotIds: Set<number>,
    dynamicStates: Map<number, DynamicState>
  ) {
    this.engine = engine;
    this.seed = seed;
    this.knots = knots;
    this.knotStates = knotStates;
    this.activeKnotId = activeKnotId;
    this.collapsedKnotIds = collapsedKnotIds;
    this.dynamicStates = dynamicStates;
  }

  /**
   * Create a new tree with given engine and seed
   */
  public static newTree(engine: 'dgdebug' | 'frotz' | 'frotz-release', seed: number): SkeinTree {
    const initialKnot: WireKnot = {
      id: 0,
      command: 'START',
      response: {
        text: 'Welcome to the game. > ',
        inputType: 'line'
      },
      unblessedResponse: null,
      parentId: null,
      label: 'START',
      locked: false,
      marker: null
    };

    const initialState: KnotState = {
      state: 'valid', // Root knot is always valid
      treeState: 'valid',
      selectedChild: null,
      children: []
    };

    return new SkeinTree(
      engine,
      seed,
      Map<number, WireKnot>().set(0, initialKnot),
      Map<number, KnotState>().set(0, initialState),
      0,
      Set<number>(),
      Map<number, DynamicState>()
    );
  }

  /**
   * Add a child knot to the tree - returns a new SkeinTree instance
   */
  public addChild(parentId: number, command: string, response: Response): SkeinTree {
    // Create new knot with unique ID
    const newId = this.generateNextId();

    // Get parent knot for reference
    const parentKnot = this.knots.get(parentId);
    if (!parentKnot) {
      throw new Error(`Parent knot ${parentId} not found`);
    }

    // Create new knot
    const newKnot: WireKnot = {
      id: newId,
      command,
      response: null, // No blessed response yet
      unblessedResponse: response,
      parentId,
      label: null,
      locked: false,
      marker: null
    };

    // Create new state for the knot
    const newState: KnotState = {
      state: 'new', // New knot has no blessed response
      treeState: 'new',
      selectedChild: null,
      children: []
    };

    // Add child reference to parent, and make it the parent's selected child
    const parentState = this.knotStates.get(parentId)!;
    const updatedParentState: KnotState = {
      ...parentState,
      children: [...parentState.children, newId],
      selectedChild: newId
    };

    const knots = this.knots.set(newId, newKnot);
    let knotStates = this.knotStates
      .set(newId, newState)
      .set(parentId, updatedParentState);
    knotStates = SkeinTree.propagateTreeState(knots, knotStates, parentId);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Update knot command and response - returns a new SkeinTree instance
   */
  public updateKnotCommandAndResponse(id: number, command: string, response: Response): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const updatedKnot: WireKnot = {
      ...knot,
      command,
      unblessedResponse: responseAfterUpdate(knot, response)
    };

    const knots = this.knots.set(id, updatedKnot);
    const knotStates = SkeinTree.propagateOwnStateChange(knots, this.knotStates, id, updatedKnot);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Update knot response only - returns a new SkeinTree instance
   */
  public updateKnotResponse(id: number, response: Response): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const updatedKnot: WireKnot = {
      ...knot,
      unblessedResponse: responseAfterUpdate(knot, response)
    };

    const knots = this.knots.set(id, updatedKnot);
    const knotStates = SkeinTree.propagateOwnStateChange(knots, this.knotStates, id, updatedKnot);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Bless a knot by rolling unblessedResponse over to response - returns a new SkeinTree instance.
   * A no-op when there's no pending unblessedResponse (nothing to bless), rather than nulling
   * out an already-blessed response.
   */
  public blessKnot(id: number): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    if (!knot.unblessedResponse) {
      return this;
    }

    const updatedKnot: WireKnot = {
      ...knot,
      response: knot.unblessedResponse,
      unblessedResponse: null
    };

    const knots = this.knots.set(id, updatedKnot);
    const knotStates = SkeinTree.propagateOwnStateChange(knots, this.knotStates, id, updatedKnot);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Bless every non-valid knot from root to the given knot (inclusive) - i.e. blessKnot
   * applied along the whole path, skipping knots that are already valid. Backs the "Bless
   * Changes" menu action, as distinct from blessKnot's single-knot "Bless Knot".
   */
  public blessTranscript(id: number): SkeinTree {
    if (!this.knots.get(id)) {
      throw new Error(`Knot ${id} not found`);
    }

    let tree: SkeinTree = this;
    for (const pathId of this.pathFromRoot(id)) {
      const knot = tree.knots.get(pathId)!;
      if (SkeinTree.computeKnotState(knot) !== 'valid') {
        tree = tree.blessKnot(pathId);
      }
    }
    return tree;
  }

  /**
   * Delete a knot and all its descendants recursively - returns a new SkeinTree instance.
   * Also removes the knot from its (former) parent's children/selectedChild. Throws
   * KnotLockedError, without modifying anything, if the knot itself or any descendant is
   * effectively locked (locked or labeled - see isEffectivelyLocked) - deletion removes the
   * whole subtree in one go, so a lock anywhere inside it must block the whole operation.
   */
  public deleteKnot(id: number): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const subtreeIds = this.collectSubtreeIds(id);
    if (subtreeIds.some((subtreeId) => isEffectivelyLocked(this.knots.get(subtreeId)!))) {
      throw new KnotLockedError();
    }

    let knots = this.knots;
    let knotStates = this.knotStates;
    let collapsedKnotIds = this.collapsedKnotIds;
    let dynamicStates = this.dynamicStates;
    for (const descendantId of subtreeIds) {
      knots = knots.delete(descendantId);
      knotStates = knotStates.delete(descendantId);
      collapsedKnotIds = collapsedKnotIds.remove(descendantId);
      dynamicStates = dynamicStates.delete(descendantId);
    }

    if (knot.parentId !== null) {
      knotStates = SkeinTree.removeChildFromParent(knotStates, knot.parentId, id);
      knotStates = SkeinTree.propagateTreeState(knots, knotStates, knot.parentId);
    }

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, collapsedKnotIds, dynamicStates);
  }

  /**
   * Delete a knot and reparent its children to its own parent - returns a new SkeinTree
   * instance. The children take the spliced knot's place in the parent's children list.
   */
  public spliceKnot(id: number): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const knotState = this.knotStates.get(id)!;
    const childIds = knotState.children;

    let knots = this.knots.delete(id);
    let knotStates = this.knotStates.delete(id);

    for (const childId of childIds) {
      const child = knots.get(childId)!;
      knots = knots.set(childId, { ...child, parentId: knot.parentId });
    }

    if (knot.parentId !== null) {
      const parentState = knotStates.get(knot.parentId)!;
      const index = parentState.children.indexOf(id);
      const children = index === -1
        ? [...parentState.children, ...childIds]
        : [...parentState.children.slice(0, index), ...childIds, ...parentState.children.slice(index + 1)];
      knotStates = knotStates.set(knot.parentId, {
        ...parentState,
        children,
        selectedChild: parentState.selectedChild === id
          ? (childIds.length > 0 ? childIds[0] : null)
          : parentState.selectedChild
      });
      knotStates = SkeinTree.propagateTreeState(knots, knotStates, knot.parentId);
    }

    return new SkeinTree(
      this.engine,
      this.seed,
      knots,
      knotStates,
      this.activeKnotId,
      this.collapsedKnotIds.remove(id),
      this.dynamicStates.delete(id)
    );
  }

  /**
   * The id insertParent (or addChild) would assign if called right now on this exact tree state -
   * a pure preview of generateNextId's own computation, not a reservation or a mutation. Exposed
   * so SkeinSession.insertParent can know the new knot's id up front (to navigate the active knot
   * there once the process has replayed it) without insertParent itself having to report it back
   * - calling this immediately before insertParent, on the same tree, is guaranteed to agree with
   * what insertParent actually assigns, since generateNextId is a pure function of this.knots and
   * nothing happens in between.
   */
  public nextId(): number {
    return this.generateNextId();
  }

  /**
   * Insert a new parent knot above an existing knot - returns a new SkeinTree instance.
   * The existing knot becomes the (sole) child of the newly inserted parent, which takes
   * the existing knot's former place among its old parent's children. If the new parent's
   * command collides with an already-existing (different) sibling, that sibling is folded into
   * the new parent instead of coexisting alongside it - see mergeSiblingInto.
   */
  public insertParent(id: number, command: string, response: Response): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const newId = this.generateNextId();
    const oldParentId = knot.parentId;

    const newParentKnot: WireKnot = {
      id: newId,
      command,
      response: null,
      unblessedResponse: response,
      parentId: oldParentId,
      label: null,
      locked: false,
      marker: null
    };
    const newParentState: KnotState = {
      state: 'new',
      treeState: 'new',
      selectedChild: id,
      children: [id]
    };

    const updatedKnot: WireKnot = { ...knot, parentId: newId };

    let knots = this.knots.set(newId, newParentKnot).set(id, updatedKnot);
    let knotStates = this.knotStates.set(newId, newParentState);
    let collapsedKnotIds = this.collapsedKnotIds;
    let dynamicStates = this.dynamicStates;
    let activeKnotId = this.activeKnotId;

    if (oldParentId !== null) {
      const grandparentState = knotStates.get(oldParentId)!;
      const index = grandparentState.children.indexOf(id);
      const children = index === -1
        ? grandparentState.children
        : [...grandparentState.children.slice(0, index), newId, ...grandparentState.children.slice(index + 1)];
      knotStates = knotStates.set(oldParentId, {
        ...grandparentState,
        children,
        selectedChild: grandparentState.selectedChild === id ? newId : grandparentState.selectedChild
      });

      const otherId = children.find((cid) => cid !== newId && knots.get(cid)!.command === command) ?? null;
      if (otherId !== null) {
        const merged = new SkeinTree(this.engine, this.seed, knots, knotStates, activeKnotId, collapsedKnotIds, dynamicStates)
          .mergeSiblingInto(newId, otherId);
        knots = merged.knots;
        knotStates = merged.knotStates;
        collapsedKnotIds = merged.collapsedKnotIds;
        dynamicStates = merged.dynamicStates;
        activeKnotId = merged.activeKnotId;
        knotStates = SkeinTree.absorbSiblingInParent(knotStates, oldParentId, newId, otherId);
      }
    }

    // Recomputes newId's own treeState from its children, then continues upward - covers both
    // the newly inserted knot (whether or not it just absorbed a colliding sibling) and its
    // ancestors in one pass.
    knotStates = SkeinTree.propagateTreeState(knots, knotStates, newId);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, activeKnotId, collapsedKnotIds, dynamicStates);
  }

  /**
   * Set label for a knot - returns a new SkeinTree instance. Labels are tree-unique: a non-null
   * label already carried by a *different* knot throws LabelConflictError rather than silently
   * stealing it. null (clearing a label) is always allowed regardless of how many other knots are
   * also unlabeled - only actual non-blank labels need to be distinct.
   */
  public setLabel(id: number, label: string | null): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }
    if (label !== null) {
      const existing = this.findByLabel(label);
      if (existing && existing.id !== id) {
        throw new LabelConflictError(label);
      }
    }

    const updatedKnot: WireKnot = {
      ...knot,
      label
    };

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * The knot currently carrying the given non-null label, if any - setLabel's uniqueness check,
   * also used by dialog-web-export.ts to locate a "WALKTHROUGH"-labeled knot in a saved
   * default.skein.
   */
  public findByLabel(label: string): WireKnot | null {
    for (const knot of this.knots.valueSeq()) {
      if (knot.label === label) {
        return knot;
      }
    }
    return null;
  }

  /**
   * Set (or clear) a knot's marker - returns a new SkeinTree instance. Unlike setLabel, markers
   * aren't tree-unique, so there's no conflict check - any number of knots can share a marker.
   */
  public setMarker(id: number, marker: Marker | null): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, { ...knot, marker }),
      this.knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Rename a knot's command - returns a new SkeinTree instance. Unlike a label (tree-wide unique
   * via findByLabel), command uniqueness is scoped to siblings sharing the same parent - the same
   * scope findChildId itself uses when runCommand decides whether to reuse an existing child or
   * create a new one. Renaming to the knot's own already-current command is a no-op. A collision
   * with a *different* sibling no longer rejects the rename - id keeps its own identity and the
   * colliding sibling is folded into it instead (see mergeSiblingInto), rather than the two
   * coexisting as separate same-command knots. Aside from that merge, deliberately doesn't touch
   * response/unblessedResponse or knot state at all - the caller (session.ts's setCommand) is
   * responsible for replaying to refresh the knot's response under its new command, mirroring
   * dialog-tool's tree/change-command (a pure rename, documented there as not affecting status
   * "until the command is re-executed") always being paired with its caller's own do-replay-to!.
   */
  public renameCommand(id: number, command: string): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }
    if (command === knot.command) {
      return this;
    }

    let knots = this.knots.set(id, { ...knot, command });
    let knotStates = this.knotStates;
    let collapsedKnotIds = this.collapsedKnotIds;
    let dynamicStates = this.dynamicStates;
    let activeKnotId = this.activeKnotId;

    if (knot.parentId !== null) {
      const parentState = knotStates.get(knot.parentId)!;
      const otherId = parentState.children.find((cid) => cid !== id && knots.get(cid)!.command === command) ?? null;
      if (otherId !== null) {
        const merged = new SkeinTree(this.engine, this.seed, knots, knotStates, activeKnotId, collapsedKnotIds, dynamicStates)
          .mergeSiblingInto(id, otherId);
        knots = merged.knots;
        knotStates = merged.knotStates;
        collapsedKnotIds = merged.collapsedKnotIds;
        dynamicStates = merged.dynamicStates;
        activeKnotId = merged.activeKnotId;
        knotStates = SkeinTree.absorbSiblingInParent(knotStates, knot.parentId, id, otherId);
        knotStates = SkeinTree.propagateTreeState(knots, knotStates, knot.parentId);
      }
    }

    return new SkeinTree(this.engine, this.seed, knots, knotStates, activeKnotId, collapsedKnotIds, dynamicStates);
  }

  /**
   * Folds otherId's whole subtree into keepId - both must currently share a command (the
   * caller's own edit, either renameCommand or insertParent, just produced that collision; no
   * safeguard rejects it anymore, two same-command siblings recursively merge into one instead).
   * keepId survives; otherId - and every id absorbed along the way, at whatever depth - is
   * deleted. keepId adopts otherId's label if it didn't already carry one of its own (one of the
   * two labels is simply dropped on an actual collision, which is fine per the caller), becomes
   * locked if either side was (never silently drops a lock), and adopts otherId's marker the same
   * way as label (keep its own if it has one, else take otherId's). Each of otherId's own
   * children either merges (recursively, same rule) into an existing keepId child that already
   * shares its command, or is reparented straight under keepId when no such collision exists.
   * Deliberately doesn't touch keepId's parent's own children/selectedChild list - callers use
   * absorbSiblingInParent for that, since this method also runs recursively one level down, where
   * there's no such list (otherId was never a listed child of keepId's parent to begin with).
   */
  private mergeSiblingInto(keepId: number, otherId: number): SkeinTree {
    const keepKnot = this.knots.get(keepId)!;
    const otherKnot = this.knots.get(otherId)!;
    const otherState = this.knotStates.get(otherId)!;

    let knots = this.knots.set(keepId, {
      ...keepKnot,
      label: keepKnot.label ?? otherKnot.label,
      locked: keepKnot.locked || otherKnot.locked,
      marker: keepKnot.marker ?? otherKnot.marker
    });
    let knotStates = this.knotStates;
    let collapsedKnotIds = this.collapsedKnotIds;
    let dynamicStates = this.dynamicStates;
    let activeKnotId = this.activeKnotId;

    for (const otherChildId of otherState.children) {
      const otherChildCommand = knots.get(otherChildId)!.command;
      const keepState = knotStates.get(keepId)!;
      const matchedKeepChildId = keepState.children.find((cid) => knots.get(cid)!.command === otherChildCommand) ?? null;

      if (matchedKeepChildId !== null) {
        const merged = new SkeinTree(this.engine, this.seed, knots, knotStates, activeKnotId, collapsedKnotIds, dynamicStates)
          .mergeSiblingInto(matchedKeepChildId, otherChildId);
        knots = merged.knots;
        knotStates = merged.knotStates;
        collapsedKnotIds = merged.collapsedKnotIds;
        dynamicStates = merged.dynamicStates;
        activeKnotId = merged.activeKnotId;
      } else {
        knots = knots.set(otherChildId, { ...knots.get(otherChildId)!, parentId: keepId });
        const ks = knotStates.get(keepId)!;
        knotStates = knotStates.set(keepId, {
          ...ks,
          children: [...ks.children, otherChildId],
          selectedChild: ks.selectedChild ?? otherChildId
        });
      }
    }

    knots = knots.delete(otherId);
    knotStates = knotStates.delete(otherId);
    collapsedKnotIds = collapsedKnotIds.remove(otherId);
    dynamicStates = dynamicStates.delete(otherId);
    if (activeKnotId === otherId) {
      activeKnotId = keepId;
    }

    // Recomputes keepId's own treeState from its (now-final) children - deliberately not the
    // full propagateTreeState walk up to root: otherId's former parent still lists otherId among
    // its children at this point (the top-level caller fixes that afterward, via
    // absorbSiblingInParent), so walking past keepId here would read a treeState for an id
    // that's just been deleted.
    const keepState = knotStates.get(keepId)!;
    const treeState = keepState.children.reduce(
      (acc, cid) => SkeinTree.maxStatus(acc, knotStates.get(cid)!.treeState),
      keepState.state
    );
    knotStates = knotStates.set(keepId, { ...keepState, treeState });

    return new SkeinTree(this.engine, this.seed, knots, knotStates, activeKnotId, collapsedKnotIds, dynamicStates);
  }

  /**
   * Removes otherId from parentId's children (it just got folded into keepId - see
   * mergeSiblingInto), redirecting parentId's own selectedChild to keepId if otherId was the one
   * selected, so a merge never leaves a parent "selecting" a knot that no longer exists.
   */
  private static absorbSiblingInParent(
    knotStates: Map<number, KnotState>,
    parentId: number,
    keepId: number,
    otherId: number
  ): Map<number, KnotState> {
    const parentState = knotStates.get(parentId)!;
    const children = parentState.children.filter((cid) => cid !== otherId);
    return knotStates.set(parentId, {
      ...parentState,
      children,
      selectedChild: parentState.selectedChild === otherId ? keepId : parentState.selectedChild
    });
  }

  /**
   * Set lock status for a knot - returns a new SkeinTree instance
   */
  public setLockStatus(id: number, locked: boolean): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const updatedKnot: WireKnot = {
      ...knot,
      locked
    };

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Get a knot by ID
   */
  public getKnot(id: number): WireKnot | null {
    return this.knots.get(id) || null;
  }

  /**
   * What kind of input id's own response leaves the interpreter expecting next: 'line' for a
   * normal command, 'key' for a single-keystroke prompt (e.g. "[MORE]" or "Press any key").
   * Reads whichever of response/unblessedResponse is current, same as render.ts's own knot-state
   * lookups, since most live knots won't have a blessed response yet. null (no active knot, or a
   * knot with no response recorded yet - e.g. a freshly created tree) defaults to 'line', the only
   * sensible starting state. This is the single source of truth callers use to decide whether a
   * command must be sent to the process as a keystroke rather than a line (SkeinSession.runCommand/
   * replayPath/traceKnot) and whether to render the keystroke command-input widget instead of the
   * normal one (render.ts's activeInputType/reachedViaKeystroke).
   */
  public promptTypeAt(id: number | null): 'line' | 'key' {
    if (id === null) {
      return 'line';
    }
    const knot = this.knots.get(id);
    const response = knot?.response ?? knot?.unblessedResponse;
    return response?.inputType ?? 'line';
  }

  /**
   * Records the parsed @dynamic state captured immediately after id's own command ran -
   * SkeinSession.captureDynamicState's storage half. Overwrites whatever was captured there
   * before (a knot only ever has one "current" dynamic snapshot, same as its response).
   */
  public updateDynamicState(id: number, state: DynamicState): SkeinTree {
    if (!this.knots.get(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    return new SkeinTree(
      this.engine,
      this.seed,
      this.knots,
      this.knotStates,
      this.activeKnotId,
      this.collapsedKnotIds,
      this.dynamicStates.set(id, state)
    );
  }

  /**
   * The @dynamic state captured for id itself, or null if none has been captured this session
   * (e.g. a freshly loaded skein, or a knot reached only via a keystroke prompt - dynamic state
   * isn't persisted to the .skein file, see dynamicStates' own doc comment). render.ts's
   * findDynamicState walks up to an ancestor when a specific knot has none of its own.
   */
  public getDynamicState(id: number): DynamicState | null {
    return this.dynamicStates.get(id) ?? null;
  }

  /**
   * Finds an existing child of parentId whose command matches exactly, or null if none does -
   * mirrors dialog-tool's tree/find-child-id. Used to reuse a knot when the same command is run
   * again from the same parent, rather than creating a duplicate.
   */
  public findChildId(parentId: number, command: string): number | null {
    const parentState = this.knotStates.get(parentId);
    if (!parentState) {
      return null;
    }
    for (const childId of parentState.children) {
      if (this.knots.get(childId)?.command === command) {
        return childId;
      }
    }
    return null;
  }

  /**
   * parentId's children, sorted by command text - the single source of truth for sibling order,
   * shared by tree-pane.ts's rendering and SkeinSession.navigateSpine's left/right keyboard
   * navigation, so the two always agree: pressing "next sibling" always lands on whichever pill
   * visually sits to the right. Returns an empty array for an unknown id or a childless knot.
   */
  public sortedChildren(parentId: number): DerivedKnot[] {
    const state = this.knotStates.get(parentId);
    if (!state) {
      return [];
    }
    return state.children.map((id) => this.getDerivedKnot(id)!).sort((a, b) => a.command.localeCompare(b.command));
  }

  /**
   * The command path from root to id, inclusive of id but excluding root itself (root has no
   * command to replay - its response comes from the interpreter's startup banner). Used by
   * SkeinSession.replayTo to restart the process and resend each command in order.
   */
  public commandPath(id: number): { id: number; command: string }[] {
    if (!this.knots.get(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    return this.pathFromRoot(id)
      .filter((pathId) => pathId !== 0)
      .map((pathId) => ({ id: pathId, command: this.knots.get(pathId)!.command }));
  }

  /**
   * Get all knots in the tree
   */
  public getAllKnots(): WireKnot[] {
    return this.knots.valueSeq().toArray();
  }

  /**
   * Get a derived knot (for UI display)
   */
  public getDerivedKnot(id: number): DerivedKnot | null {
    const knot = this.knots.get(id);
    if (!knot) {
      return null;
    }

    const state = this.knotStates.get(id);

    return {
      id: knot.id,
      command: knot.command,
      response: knot.response ? knot.response.text : '',
      unblessedResponse: knot.unblessedResponse ? knot.unblessedResponse.text : null,
      state: state ? state.state : SkeinTree.computeKnotState(knot),
      treeState: state ? state.treeState : SkeinTree.computeKnotState(knot),
      parentId: knot.parentId,
      children: state ? state.children : [],
      selectedChild: state ? state.selectedChild : null,
      inputType: knot.response ? knot.response.inputType : 'line',
      label: knot.label,
      locked: knot.locked,
      marker: knot.marker,
      collapsed: this.collapsedKnotIds.has(id)
    };
  }

  /**
   * The ids that should remain visible in the tree pane when filtering to a single marker color:
   * every knot that itself carries that marker, plus every ancestor of such a knot (so the path
   * from root down to a match is never broken). A plain O(n) bottom-up walk done fresh on every
   * call, not an incrementally-maintained aggregate like treeState - the whole app already
   * re-renders in full on every mutation (see service.ts's broadcast/sendPatch), so there's no
   * incremental-render path this would need to hook into, and one full-tree walk per render is
   * cheap. Returns an empty set (not including the root) when nothing anywhere matches - it's the
   * tree-pane's own rendering, not this query, that decides to still show the root as an anchor.
   */
  public visibleKnotIdsForMarkerFilter(marker: Marker): globalThis.Set<number> {
    const visible = new globalThis.Set<number>();
    const visit = (id: number): boolean => {
      const knot = this.knots.get(id)!;
      const state = this.knotStates.get(id)!;
      const anyChildMatches = state.children.map(visit).some(Boolean);
      const selfMatches = knot.marker === marker;
      if (anyChildMatches || selfMatches) {
        visible.add(id);
        return true;
      }
      return false;
    };
    visit(0);
    return visible;
  }

  /**
   * Derive a knot's own status from its response/unblessedResponse content. Does not consider
   * descendants - see propagateTreeState for how that own status feeds into treeState.
   */
  private static computeKnotState(knot: WireKnot): KnotStatus {
    if (knot.response) {
      if (knot.unblessedResponse && knot.response.text !== knot.unblessedResponse.text) {
        return 'error';
      }
      return 'valid';
    }
    return 'new';
  }

  /**
   * The greater of two statuses, ranking error > new > valid.
   */
  private static maxStatus(a: KnotStatus, b: KnotStatus): KnotStatus {
    if (a === 'error' || b === 'error') {
      return 'error';
    }
    if (a === 'new' || b === 'new') {
      return 'new';
    }
    return 'valid';
  }

  /**
   * Recomputes a knot's own `state` from its (already-updated) WireKnot, then propagates
   * treeState from that knot upward. Used by every mutation that changes a knot's
   * response/unblessedResponse (updateKnotCommandAndResponse, updateKnotResponse, blessKnot).
   */
  private static propagateOwnStateChange(
    knots: Map<number, WireKnot>,
    knotStates: Map<number, KnotState>,
    id: number,
    updatedKnot: WireKnot
  ): Map<number, KnotState> {
    const state = knotStates.get(id)!;
    const withUpdatedState = knotStates.set(id, { ...state, state: SkeinTree.computeKnotState(updatedKnot) });
    return SkeinTree.propagateTreeState(knots, withUpdatedState, id);
  }

  /**
   * Recomputes treeState at startId (as the greatest of its own state and its children's
   * treeState) and continues upward through every ancestor to the root, mirroring dialog-tool's
   * tree.clj propagate-status. Each level's computation only reads its immediate children's
   * already-correct treeState, not the whole subtree, so a single call costs O(depth), not
   * O(subtree size) - the whole reason treeState is stored and propagated rather than
   * recomputed from scratch on every read.
   */
  private static propagateTreeState(
    knots: Map<number, WireKnot>,
    knotStates: Map<number, KnotState>,
    startId: number
  ): Map<number, KnotState> {
    let states = knotStates;
    let currentId: number | null = startId;

    while (currentId !== null) {
      const current = states.get(currentId)!;
      const computed = current.children.reduce(
        (acc, childId) => SkeinTree.maxStatus(acc, states.get(childId)!.treeState),
        current.state
      );

      states = states.set(currentId, { ...current, treeState: computed });
      currentId = knots.get(currentId)!.parentId;
    }

    return states;
  }

  /**
   * Collect a knot's id and all its descendants' ids.
   */
  private collectSubtreeIds(id: number): number[] {
    const ids: number[] = [id];
    const state = this.knotStates.get(id);
    if (state) {
      for (const childId of state.children) {
        ids.push(...this.collectSubtreeIds(childId));
      }
    }
    return ids;
  }

  /**
   * The path of knot ids from the root (id 0) down to the given knot, inclusive.
   */
  private pathFromRoot(id: number): number[] {
    const path: number[] = [];
    let current: WireKnot | undefined = this.knots.get(id);
    while (current) {
      path.unshift(current.id);
      current = current.parentId !== null ? this.knots.get(current.parentId) : undefined;
    }
    return path;
  }

  /**
   * Remove childId from parentId's children/selectedChild, reassigning selectedChild to the
   * next remaining child (or null) if the removed child was selected.
   */
  private static removeChildFromParent(
    knotStates: Map<number, KnotState>,
    parentId: number,
    childId: number
  ): Map<number, KnotState> {
    const parentState = knotStates.get(parentId);
    if (!parentState) {
      return knotStates;
    }

    const children = parentState.children.filter((existingId) => existingId !== childId);
    return knotStates.set(parentId, {
      ...parentState,
      children,
      selectedChild: parentState.selectedChild === childId
        ? (children.length > 0 ? children[0] : null)
        : parentState.selectedChild
    });
  }

  /**
   * Reconstruct a tree from a flat, unordered list of WireKnots - e.g. as read back from
   * a skein file, which stores only id/parentId per knot and not the derived children/
   * selectedChild structure. Mirrors dialog-tool's tree/rebuild: children are grouped by
   * parentId, and each parent's selectedChild is the first child encountered when knots
   * are processed in ascending id order.
   */
  public static fromKnots(
    engine: 'dgdebug' | 'frotz' | 'frotz-release',
    seed: number,
    wireKnots: WireKnot[]
  ): SkeinTree {
    const sorted = [...wireKnots].sort((a, b) => a.id - b.id);

    const childrenByParent = new globalThis.Map<number, number[]>();
    for (const knot of sorted) {
      if (knot.parentId !== null) {
        const children = childrenByParent.get(knot.parentId) ?? [];
        children.push(knot.id);
        childrenByParent.set(knot.parentId, children);
      }
    }

    let knots = Map<number, WireKnot>();
    let knotStates = Map<number, KnotState>();
    for (const knot of sorted) {
      const children = childrenByParent.get(knot.id) ?? [];
      const knotState = SkeinTree.computeKnotState(knot);
      knots = knots.set(knot.id, knot);
      // treeState starts equal to the knot's own state (as if it had no children yet) and
      // gets corrected below, bottom-up, once every knot's entry exists.
      knotStates = knotStates.set(knot.id, {
        state: knotState,
        treeState: knotState,
        selectedChild: children.length > 0 ? children[0] : null,
        children
      });
    }

    const leafIds = sorted.filter((knot) => !childrenByParent.has(knot.id)).map((knot) => knot.id);
    for (const leafId of leafIds) {
      knotStates = SkeinTree.propagateTreeState(knots, knotStates, leafId);
    }

    // Mirrors dialog-tool's init-tree (called after every rebuild-from-file): the active knot
    // starts at the leaf of the selected spine, not root - found by walking selectedChild
    // downward from root until a knot with no selected child (a leaf along that spine).
    let activeKnotId = 0;
    let cursor: number | null = 0;
    while (cursor !== null) {
      activeKnotId = cursor;
      cursor = knotStates.get(cursor)?.selectedChild ?? null;
    }

    // collapsedKnotIds always starts empty on rebuild-from-file - presentation state, not
    // persisted (see WireKnot/the field's own doc comment), matching dialog-tool's own
    // expanded-ids being recomputed at load time rather than read from the file.
    return new SkeinTree(engine, seed, knots, knotStates, activeKnotId, Set<number>(), Map<number, DynamicState>());
  }

  /**
   * Generate a unique ID for knots
   */
  private generateNextId(): number {
    // Find next available ID (this is simplified)
    let maxId = -1;
    this.knots.forEach((knot) => {
      if (knot.id > maxId) {
        maxId = knot.id;
      }
    });
    return maxId + 1;
  }

  /**
   * Get the interpreter engine this tree was created with
   */
  public getEngine(): 'dgdebug' | 'frotz' | 'frotz-release' {
    return this.engine;
  }

  /**
   * Get the random seed this tree was created with
   */
  public getSeed(): number {
    return this.seed;
  }

  /**
   * Get active knot ID
   */
  public getActiveKnotId(): number | null {
    return this.activeKnotId;
  }

  /**
   * The leaf of the currently selected spine - root, then following selectedChild all the way
   * down. This is "the whole spine" render.ts's selectedKnots renders into the transcript, and
   * what Bless Transcript operates on - deliberately NOT activeKnotId, which (since selectKnot)
   * can be any knot navigated to partway up that same spine. Using activeKnotId for any of those
   * would silently stop short at wherever the user last clicked, even though the transcript itself
   * keeps showing everything past it (see selectKnot's doc comment) - this is what those
   * operations actually mean by "the active spine". SkeinSession.replayAll uses this to pick which
   * leaf's process to keep as the live one, but - unlike Bless Transcript - never moves
   * activeKnotId to it; replaying refreshes responses, it doesn't navigate.
   */
  public getSelectedLeafId(): number {
    let currentId = 0;
    for (;;) {
      const state = this.knotStates.get(currentId);
      if (!state || state.selectedChild === null) {
        return currentId;
      }
      currentId = state.selectedChild;
    }
  }

  /**
   * Every knot id whose own status (not aggregated treeState - a valid knot with a new/error
   * descendant doesn't count) equals status, ascending by id - mirrors dialog-tool's tree/knots-
   * with-status. SkeinSession.seekStatus (the navbar's clickable new/error count badges) cycles
   * through this list in order.
   */
  public knotIdsWithStatus(status: KnotStatus): number[] {
    return this.knotStates
      .filter((state) => state.state === status)
      .keySeq()
      .toArray()
      .sort((a, b) => a - b);
  }

  /**
   * Every leaf id in the tree - knots with no children - not just the currently selected spine's
   * one leaf (see getSelectedLeafId). Ascending id order, so SkeinSession.replayAll's replay
   * order is deterministic and matches the order knots were created in. Used to implement
   * "replay all paths" (technical-design.md's toolbar spec), as distinct from replaying just the
   * one path currently shown in the transcript.
   */
  public getLeafIds(): number[] {
    return this.knotStates
      .filter((state) => state.children.length === 0)
      .keySeq()
      .toArray()
      .sort((a, b) => a - b);
  }

  /**
   * Set active knot ID
   */
  public setActiveKnotId(id: number | null): SkeinTree {
    return new SkeinTree(this.engine, this.seed, this.knots, this.knotStates, id, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * The real click-to-navigate operation - ported from dialog-tool's session/select-knot (tree/
   * select-knot + tree/extend-selection) + set-active-knot-id. render.ts's selectedKnots renders
   * root-to-leaf by walking selectedChild, not root-to-activeKnotId (see setActiveKnotId's own
   * doc comment above, and toggleCollapsed's) - so a plain setActiveKnotId(id) alone left whatever
   * was already explored past id, at every ancestor above id, exactly as it was. That's correct
   * when id is already on the currently-selected path (nothing to change), but wrong the moment
   * id sits in a different branch: the transcript would keep showing the *old* branch below the
   * point where they diverge, not id at all. selectKnot fixes that by re-pointing selectedChild
   * along the path down to id first (selectPath), then - since id itself might already have its
   * own unambiguous continuation worth showing automatically - extends through single-child
   * chains below id (extendSelection). Neither step ever touches a real branch point's existing
   * selectedChild (2+ children keeps whatever was already selected there), and neither ever
   * removes a knot - only addChild's own selectedChild reassignment (a genuinely new branch)
   * changes what's displayed past a branch point; selecting an existing knot never truncates
   * anything, which is the whole point of this method existing separately from setActiveKnotId.
   */
  public selectKnot(id: number): SkeinTree {
    if (!this.knots.get(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    return this.selectPath(id).extendSelection(id).setActiveKnotId(id);
  }

  /**
   * Reassigns selectedChild along the path from root down to id - see selectKnot's doc comment.
   */
  private selectPath(id: number): SkeinTree {
    const path = this.pathFromRoot(id);
    let knotStates = this.knotStates;
    for (let i = 0; i < path.length - 1; i++) {
      const parentId = path[i];
      const childId = path[i + 1];
      const parentState = knotStates.get(parentId)!;
      if (parentState.selectedChild !== childId) {
        knotStates = knotStates.set(parentId, { ...parentState, selectedChild: childId });
      }
    }
    return new SkeinTree(this.engine, this.seed, this.knots, knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Extends selection downward from id through single-child chains until a leaf or an actual
   * branch point (2+ children) - see selectKnot's doc comment. A branch point's own already-
   * explored selectedChild is left exactly as it was.
   */
  private extendSelection(id: number): SkeinTree {
    let knotStates = this.knotStates;
    let currentId = id;
    for (;;) {
      const state = knotStates.get(currentId);
      if (!state || state.children.length !== 1) {
        break;
      }
      const childId = state.children[0];
      knotStates = knotStates.set(currentId, { ...state, selectedChild: childId });
      currentId = childId;
    }
    return new SkeinTree(this.engine, this.seed, this.knots, knotStates, this.activeKnotId, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Prepares to add a new child under id - the actions menu's "New Child" action, distinct from
   * selectKnot's plain click-to-navigate (which auto-extends into whatever's already explored
   * past the clicked knot - see its own doc comment). Re-points selectedChild along the path from
   * root down to id (selectPath, the same first step selectKnot takes) so the transcript reaches
   * id even when id sits in a different branch than what's currently displayed, but then
   * explicitly clears id's own selectedChild instead of extending into an existing child chain -
   * the transcript stops exactly at id, with nothing shown past it, so the command input reads as
   * "type the next thing from here" rather than silently reusing whatever was already explored
   * underneath.
   */
  public selectForNewChild(id: number): SkeinTree {
    if (!this.knots.get(id)) {
      throw new Error(`Knot ${id} not found`);
    }
    const afterPath = this.selectPath(id);
    const state = afterPath.knotStates.get(id)!;
    const knotStates =
      state.selectedChild === null ? afterPath.knotStates : afterPath.knotStates.set(id, { ...state, selectedChild: null });
    return new SkeinTree(this.engine, this.seed, this.knots, knotStates, id, this.collapsedKnotIds, this.dynamicStates);
  }

  /**
   * Toggles id's tree/graph pane subtree between collapsed (children hidden) and expanded -
   * the small chevron below any node with children (see tree-pane.ts's renderTreeNode).
   *
   * Collapsing id can hide the active knot: the transcript always renders root-to-active-leaf
   * (selectedKnots in render.ts), so if activeKnotId is a strict descendant of the knot just
   * collapsed, it just became something the graph pane no longer shows at all - left alone,
   * the transcript would keep displaying knots the graph pane has hidden, which is exactly the
   * "conflict between what's in the transcript and what's in the nav graph" this guards against.
   * id itself is the nearest still-visible ancestor of everything being hidden, so that's where
   * active moves to - never on expand, and never when the collapsed subtree doesn't contain the
   * active knot.
   */
  public toggleCollapsed(id: number): SkeinTree {
    if (!this.knots.get(id)) {
      throw new Error(`Knot ${id} not found`);
    }

    const collapsing = !this.collapsedKnotIds.has(id);
    const collapsedKnotIds = collapsing ? this.collapsedKnotIds.add(id) : this.collapsedKnotIds.remove(id);

    const activeKnotId =
      collapsing && this.activeKnotId !== null && this.isDescendantOf(this.activeKnotId, id) ? id : this.activeKnotId;

    return new SkeinTree(this.engine, this.seed, this.knots, this.knotStates, activeKnotId, collapsedKnotIds, this.dynamicStates);
  }

  /** Whether id is a strict descendant of ancestorId (walks up via parentId; false for id === ancestorId). */
  private isDescendantOf(id: number, ancestorId: number): boolean {
    let current = this.knots.get(id)?.parentId ?? null;
    while (current !== null) {
      if (current === ancestorId) {
        return true;
      }
      current = this.knots.get(current)?.parentId ?? null;
    }
    return false;
  }
}
