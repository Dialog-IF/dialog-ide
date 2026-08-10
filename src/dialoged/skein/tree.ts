/**
 * Tree structure and knot management for the Skein engine.
 * Implements immutable persistent data structures as specified in the technical design.
 */

import { Map, Set } from 'immutable';

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
 * A knot's own status, or (for treeState) the greatest status among a knot and its
 * descendants. Ordering: error > new > valid.
 */
export type KnotStatus = 'new' | 'valid' | 'error';

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

  private constructor(
    engine: 'dgdebug' | 'frotz' | 'frotz-release',
    seed: number,
    knots: Map<number, WireKnot>,
    knotStates: Map<number, KnotState>,
    activeKnotId: number | null,
    collapsedKnotIds: Set<number>
  ) {
    this.engine = engine;
    this.seed = seed;
    this.knots = knots;
    this.knotStates = knotStates;
    this.activeKnotId = activeKnotId;
    this.collapsedKnotIds = collapsedKnotIds;
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
      locked: false
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
      Set<number>()
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
      locked: false
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds);
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
      unblessedResponse: response
    };

    const knots = this.knots.set(id, updatedKnot);
    const knotStates = SkeinTree.propagateOwnStateChange(knots, this.knotStates, id, updatedKnot);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds);
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
      unblessedResponse: response
    };

    const knots = this.knots.set(id, updatedKnot);
    const knotStates = SkeinTree.propagateOwnStateChange(knots, this.knotStates, id, updatedKnot);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds);
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds);
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
   * Also removes the knot from its (former) parent's children/selectedChild.
   */
  public deleteKnot(id: number): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    let knots = this.knots;
    let knotStates = this.knotStates;
    let collapsedKnotIds = this.collapsedKnotIds;
    for (const descendantId of this.collectSubtreeIds(id)) {
      knots = knots.delete(descendantId);
      knotStates = knotStates.delete(descendantId);
      collapsedKnotIds = collapsedKnotIds.remove(descendantId);
    }

    if (knot.parentId !== null) {
      knotStates = SkeinTree.removeChildFromParent(knotStates, knot.parentId, id);
      knotStates = SkeinTree.propagateTreeState(knots, knotStates, knot.parentId);
    }

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, collapsedKnotIds);
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds.remove(id));
  }

  /**
   * Insert a new parent knot above an existing knot - returns a new SkeinTree instance.
   * The existing knot becomes the (sole) child of the newly inserted parent, which takes
   * the existing knot's former place among its old parent's children.
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
      locked: false
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
    }

    // Recomputes newId's own treeState from its (pre-existing) child id, then continues
    // upward - covers both the newly inserted knot and its ancestors in one pass.
    knotStates = SkeinTree.propagateTreeState(knots, knotStates, newId);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId, this.collapsedKnotIds);
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

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId, this.collapsedKnotIds);
  }

  /** The knot currently carrying the given non-null label, if any - setLabel's uniqueness check. */
  private findByLabel(label: string): WireKnot | null {
    for (const knot of this.knots.valueSeq()) {
      if (knot.label === label) {
        return knot;
      }
    }
    return null;
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

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId, this.collapsedKnotIds);
  }

  /**
   * Get a knot by ID
   */
  public getKnot(id: number): WireKnot | null {
    return this.knots.get(id) || null;
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
      collapsed: this.collapsedKnotIds.has(id)
    };
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
    return new SkeinTree(engine, seed, knots, knotStates, activeKnotId, Set<number>());
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
   * what the navbar's Replay All / Bless Transcript operate on - deliberately NOT activeKnotId,
   * which (since selectKnot) can be any knot navigated to partway up that same spine. Using
   * activeKnotId for either of those would silently stop short at wherever the user last clicked,
   * even though the transcript itself keeps showing everything past it (see selectKnot's doc
   * comment) - this is what those two operations actually mean by "the active spine".
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
   * Set active knot ID
   */
  public setActiveKnotId(id: number | null): SkeinTree {
    return new SkeinTree(this.engine, this.seed, this.knots, this.knotStates, id, this.collapsedKnotIds);
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
    return new SkeinTree(this.engine, this.seed, this.knots, knotStates, this.activeKnotId, this.collapsedKnotIds);
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
    return new SkeinTree(this.engine, this.seed, this.knots, knotStates, this.activeKnotId, this.collapsedKnotIds);
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
    return new SkeinTree(this.engine, this.seed, this.knots, knotStates, id, this.collapsedKnotIds);
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

    return new SkeinTree(this.engine, this.seed, this.knots, this.knotStates, activeKnotId, collapsedKnotIds);
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
