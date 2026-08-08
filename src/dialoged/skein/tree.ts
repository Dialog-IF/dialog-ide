/**
 * Tree structure and knot management for the Skein engine.
 * Implements immutable persistent data structures as specified in the technical design.
 */

import { Map } from 'immutable';

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
  state: 'new' | 'valid' | 'error';
  treeState: 'new' | 'valid' | 'error';
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
  state: 'new' | 'valid' | 'error';
  parentId: number | null;
  children: number[];
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
  public addChild(parentId: number, command: string, response: ResponseWithInputType): SkeinTree {
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

    // Add child reference to parent
    const parentState = this.knotStates.get(parentId)!;
    const updatedParentState: KnotState = {
      ...parentState,
      children: [...parentState.children, newId]
    };

    const knots = this.knots.set(newId, newKnot);
    const knotStates = this.knotStates
      .set(newId, newState)
      .set(parentId, updatedParentState);

    return new SkeinTree(this.engine, this.seed, knots, knotStates, this.activeKnotId);
  }

  /**
   * Update knot command and response - returns a new SkeinTree instance
   */
  public updateKnotCommandAndResponse(id: number, command: string, response: ResponseWithInputType): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const updatedKnot: WireKnot = {
      ...knot,
      command,
      unblessedResponse: response
    };

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId);
  }

  /**
   * Update knot response only - returns a new SkeinTree instance
   */
  public updateKnotResponse(id: number, response: ResponseWithInputType): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const updatedKnot: WireKnot = {
      ...knot,
      unblessedResponse: response
    };

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId);
  }

  /**
   * Bless a knot by rolling unblessedResponse over to response - returns a new SkeinTree instance
   */
  public blessKnot(id: number): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    const updatedKnot: WireKnot = {
      ...knot,
      response: knot.unblessedResponse,
      unblessedResponse: null
    };

    return new SkeinTree(this.engine, this.seed, this.knots.set(id, updatedKnot), this.knotStates, this.activeKnotId);
  }

  /**
   * Delete a knot and all its descendants - returns a new SkeinTree instance
   */
  public deleteKnot(id: number): SkeinTree {
    // This is a simplified implementation - in practice would need to handle
    // recursive deletion and parent-child relationship updates properly

    return new SkeinTree(
      this.engine,
      this.seed,
      this.knots.delete(id),
      this.knotStates.delete(id),
      this.activeKnotId
    );
  }

  /**
   * Splice a knot (delete and reparent children) - returns a new SkeinTree instance
   */
  public spliceKnot(id: number): SkeinTree {
    // Simplified implementation - in practice would need to properly handle
    // reparenting of children to the parent of the deleted knot

    return new SkeinTree(
      this.engine,
      this.seed,
      this.knots.delete(id),
      this.knotStates.delete(id),
      this.activeKnotId
    );
  }

  /**
   * Insert a parent knot - returns a new SkeinTree instance
   */
  public insertParent(id: number, command: string, response: ResponseWithInputType): SkeinTree {
    // Simplified implementation - in practice would need to properly handle
    // the complex parent-child relationship changes

    return new SkeinTree(this.engine, this.seed, this.knots, this.knotStates, this.activeKnotId);
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
      state: SkeinTree.computeKnotState(knot),
      parentId: knot.parentId,
      children: state ? state.children : [],
      inputType: knot.response ? knot.response.inputType : 'line',
      label: knot.label,
      locked: knot.locked
    };
  }

  /**
   * Derive a knot's own state from its response/unblessedResponse content.
   * Does not consider descendants - see technical-design.md on tree-status propagation,
   * which isn't implemented yet.
   */
  private static computeKnotState(knot: WireKnot): 'new' | 'valid' | 'error' {
    if (knot.response) {
      if (knot.unblessedResponse && knot.response.text !== knot.unblessedResponse.text) {
        return 'error';
      }
      return 'valid';
    }
    if (knot.unblessedResponse) {
      return 'new';
    }
    return 'new';
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
      knotStates = knotStates.set(knot.id, {
        state: knotState,
        // Tree-status propagation from descendants isn't implemented yet - see computeKnotState.
        treeState: knotState,
        selectedChild: children.length > 0 ? children[0] : null,
        children
      });
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

/**
 * Response with input type information
 */
export interface ResponseWithInputType {
  text: string;
  inputType: 'line' | 'key';
}
