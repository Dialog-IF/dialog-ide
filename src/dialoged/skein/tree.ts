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
 * Tree metadata
 */
export interface TreeMetadata {
  engine: 'dgdebug' | 'frotz' | 'frotz-release';
  seed: number;
  version: string;
  created: string;
  modified: string;
}

/**
 * SkeinTree - immutable persistent tree structure
 */
export class SkeinTree {
  private metadata: TreeMetadata;
  private knots: Map<number, WireKnot>;
  private knotStates: Map<number, KnotState>;
  private activeKnotId: number | null;
  private fixedWidthFontOverride: boolean;

  constructor(engine: 'dgdebug' | 'frotz' | 'frotz-release', seed: number) {
    this.metadata = {
      engine,
      seed,
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };

    // Initialize empty tree with root knot
    this.knots = Map<number, WireKnot>();
    this.knotStates = Map<number, KnotState>();
    this.activeKnotId = null;
    this.fixedWidthFontOverride = false;

    // Create initial root knot (id 0)
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

    this.knots = this.knots.set(0, initialKnot);
    this.knotStates = this.knotStates.set(0, initialState);
    this.activeKnotId = 0;
  }

  /**
   * Create a new tree with given engine and seed
   */
  public static newTree(engine: 'dgdebug' | 'frotz' | 'frotz-release', seed: number): SkeinTree {
    return new SkeinTree(engine, seed);
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

    // Update knots and states - create a new tree instance with changes
    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing knots and states
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Add the new knot
    newTree.knots = newTree.knots.set(newId, newKnot);
    newTree.knotStates = newTree.knotStates.set(newId, newState);

    // Add child reference to parent
    const parentKnotCopy = { ...parentKnot };
    const parentState = this.knotStates.get(parentId)!;
    const updatedChildren = [...parentState.children, newId];

    const updatedParentState: KnotState = {
      ...parentState,
      children: updatedChildren
    };

    newTree.knots = newTree.knots.set(parentId, parentKnotCopy);
    newTree.knotStates = newTree.knotStates.set(parentId, updatedParentState);

    return newTree;
  }

  /**
   * Update knot command and response - returns a new SkeinTree instance
   */
  public updateKnotCommandAndResponse(id: number, command: string, response: ResponseWithInputType): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    // Create updated knot
    const updatedKnot: WireKnot = {
      ...knot,
      command,
      unblessedResponse: response
    };

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Update the specific knot
    newTree.knots = newTree.knots.set(id, updatedKnot);

    return newTree;
  }

  /**
   * Update knot response only - returns a new SkeinTree instance
   */
  public updateKnotResponse(id: number, response: ResponseWithInputType): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    // Create updated knot
    const updatedKnot: WireKnot = {
      ...knot,
      unblessedResponse: response
    };

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Update the specific knot
    newTree.knots = newTree.knots.set(id, updatedKnot);

    return newTree;
  }

  /**
   * Bless a knot by rolling unblessedResponse over to response - returns a new SkeinTree instance
   */
  public blessKnot(id: number): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    // Create updated knot
    const updatedKnot: WireKnot = {
      ...knot,
      response: knot.unblessedResponse,
      unblessedResponse: null
    };

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Update the specific knot
    newTree.knots = newTree.knots.set(id, updatedKnot);

    return newTree;
  }

  /**
   * Delete a knot and all its descendants - returns a new SkeinTree instance
   */
  public deleteKnot(id: number): SkeinTree {
    // This is a simplified implementation - in practice would need to handle
    // recursive deletion and parent-child relationship updates properly

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Delete the knot and its descendants (simplified)
    newTree.knots = newTree.knots.delete(id);
    newTree.knotStates = newTree.knotStates.delete(id);

    return newTree;
  }

  /**
   * Splice a knot (delete and reparent children) - returns a new SkeinTree instance
   */
  public spliceKnot(id: number): SkeinTree {
    // Simplified implementation - in practice would need to properly handle
    // reparenting of children to the parent of the deleted knot

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Delete the knot (simplified)
    newTree.knots = newTree.knots.delete(id);
    newTree.knotStates = newTree.knotStates.delete(id);

    return newTree;
  }

  /**
   * Insert a parent knot - returns a new SkeinTree instance
   */
  public insertParent(id: number, command: string, response: ResponseWithInputType): SkeinTree {
    // Simplified implementation - in practice would need to properly handle
    // the complex parent-child relationship changes

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    return newTree;
  }

  /**
   * Set label for a knot - returns a new SkeinTree instance
   */
  public setLabel(id: number, label: string | null): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    // Create updated knot
    const updatedKnot: WireKnot = {
      ...knot,
      label
    };

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Update the specific knot
    newTree.knots = newTree.knots.set(id, updatedKnot);

    return newTree;
  }

  /**
   * Set lock status for a knot - returns a new SkeinTree instance
   */
  public setLockStatus(id: number, locked: boolean): SkeinTree {
    const knot = this.knots.get(id);
    if (!knot) {
      throw new Error(`Knot ${id} not found`);
    }

    // Create updated knot
    const updatedKnot: WireKnot = {
      ...knot,
      locked
    };

    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = this.activeKnotId;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    // Update the specific knot
    newTree.knots = newTree.knots.set(id, updatedKnot);

    return newTree;
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

    // Determine knot state
    let knotState: 'new' | 'valid' | 'error' = 'new';
    if (knot.response) {
      if (knot.unblessedResponse && knot.response.text !== knot.unblessedResponse.text) {
        knotState = 'error';
      } else {
        knotState = 'valid';
      }
    } else if (knot.unblessedResponse) {
      knotState = 'new';
    }

    return {
      id: knot.id,
      command: knot.command,
      response: knot.response ? knot.response.text : '',
      unblessedResponse: knot.unblessedResponse ? knot.unblessedResponse.text : null,
      state: knotState,
      parentId: knot.parentId,
      children: state ? state.children : [],
      inputType: knot.response ? knot.response.inputType : 'line',
      label: knot.label,
      locked: knot.locked
    };
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
   * Get tree metadata
   */
  public getMetadata(): TreeMetadata {
    return { ...this.metadata };
  }

  /**
   * Update tree modification time
   */
  public updateModifiedTime(): void {
    this.metadata.modified = new Date().toISOString();
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
    const newTree = new SkeinTree(this.metadata.engine, this.metadata.seed);

    // Copy all existing data
    newTree.knots = this.knots;
    newTree.knotStates = this.knotStates;
    newTree.activeKnotId = id;
    newTree.fixedWidthFontOverride = this.fixedWidthFontOverride;

    return newTree;
  }
}

/**
 * Response with input type information
 */
export interface ResponseWithInputType {
  text: string;
  inputType: 'line' | 'key';
}