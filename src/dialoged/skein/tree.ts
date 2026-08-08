/**
 * Tree structure and knot management for the Skein engine.
 * Implements immutable persistent data structures as specified in the technical design.
 */

import { Map } from 'immutable';

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

  private constructor(
    engine: 'dgdebug' | 'frotz' | 'frotz-release',
    seed: number,
    knots: Map<number, WireKnot>,
    knotStates: Map<number, KnotState>,
    activeKnotId: number | null
  ) {
    this.engine = engine;
    this.seed = seed;
    this.knots = knots;
    this.knotStates = knotStates;
    this.activeKnotId = activeKnotId;
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
      0
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
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
    for (const descendantId of this.collectSubtreeIds(id)) {
      knots = knots.delete(descendantId);
      knotStates = knotStates.delete(descendantId);
    }

    if (knot.parentId !== null) {
      knotStates = SkeinTree.removeChildFromParent(knotStates, knot.parentId, id);
      knotStates = SkeinTree.propagateTreeState(knots, knotStates, knot.parentId);
    }

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
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

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
  }

  /**
   * Set label for a knot - returns a new SkeinTree instance
   */
  public setLabel(id: number, label: string | null): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const updatedKnot: WireKnot = {
      ...knot,
      label
    };

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId);
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

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId);
  }

  /**
   * Get a knot by ID
   */
  public getKnot(id: number): WireKnot | null {
    return this.knots.get(id) || null;
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
      locked: knot.locked
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

    return new SkeinTree(engine, seed, knots, knotStates, 0);
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
   * Set active knot ID
   */
  public setActiveKnotId(id: number | null): SkeinTree {
    return new SkeinTree(this.engine, this.seed, this.knots, this.knotStates, id);
  }
}
