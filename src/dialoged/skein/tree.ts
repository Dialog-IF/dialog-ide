/**
 * Tree structure and knot management for the Skein engine.
 * Represents command execution history as a tree with branching capabilities.
 */

/**
 * Knot data structure representing a single command/response pair
 */
export interface Knot {
  id: string;
  parentId: string | null;
  command: string;
  label: string | null;
  response: string;
  unblessed: boolean;
  promptType: 'line' | 'keystroke';
  dynamic: DynamicKnot;
  source: {
    file: string;
    line: number;
  };
}

/**
 * Dynamic state information for a knot
 */
export interface DynamicKnot {
  globals: Record<string, boolean>;
  objects: Record<string, {
    flags: Record<string, boolean>;
    properties: Record<string, any>;
  }>;
  changes?: Array<{
    type: 'global' | 'object';
    name: string;
    field: string | null;
    oldValue: any;
    newValue: any;
  }>;
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
 * Tree structure for session history
 */
export class SkeinTree {
  private metadata: TreeMetadata;
  private knots: Record<string, Knot> = {};
  private children: Record<string, string[]> = {};
  private selected: Record<string, string> = {};
  private status: Record<string, 'executed' | 'pending' | 'error'> = {};

  constructor(engine: 'dgdebug' | 'frotz' | 'frotz-release', seed: number) {
    this.metadata = {
      engine,
      seed,
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };

    // Create initial knot
    const initialKnot: Knot = {
      id: '0',
      parentId: null,
      command: 'start',
      label: 'Initial state',
      response: 'Welcome to the game. > ',
      unblessed: false,
      promptType: 'line',
      dynamic: {
        globals: {},
        objects: {}
      },
      source: {
        file: 'game.dlg',
        line: 1
      }
    };

    this.knots['0'] = initialKnot;
    this.children['0'] = [];
    this.status['0'] = 'executed';
  }

  /**
   * Create a new tree with given engine and seed
   */
  public static newTree(engine: 'dgdebug' | 'frotz' | 'frotz-release', seed: number): SkeinTree {
    return new SkeinTree(engine, seed);
  }

  /**
   * Add a child knot to the tree
   */
  public addChild(knotData: Omit<Knot, 'id' | 'parentId'> & { parentId?: string }): string {
    // Generate unique ID for new knot
    const newId = this.generateId();
    const parentId = knotData.parentId || '0';

    // Create parent if it doesn't exist (this is simplified)
    if (!this.knots[parentId]) {
      throw new Error(`Parent knot ${parentId} not found`);
    }

    // Create new knot
    const newKnot: Knot = {
      id: newId,
      parentId,
      command: knotData.command,
      label: knotData.label || null,
      response: knotData.response,
      unblessed: knotData.unblessed || false,
      promptType: knotData.promptType,
      dynamic: knotData.dynamic || {
        globals: {},
        objects: {}
      },
      source: knotData.source || {
        file: 'unknown',
        line: 0
      }
    };

    // Add to tree structure
    this.knots[newId] = newKnot;
    this.status[newId] = 'executed';

    // Add as child of parent
    if (!this.children[parentId]) {
      this.children[parentId] = [];
    }
    this.children[parentId].push(newId);

    // Update parent's children reference
    this.selected[parentId] = newId;

    console.log(`Added child knot ${newId} to parent ${parentId}`);
    return newId;
  }

  /**
   * Find a child knot by command
   */
  public findChildId(parentId: string, command: string): string | null {
    if (!this.children[parentId]) {
      return null;
    }

    for (const childId of this.children[parentId]) {
      if (this.knots[childId] && this.knots[childId].command === command) {
        return childId;
      }
    }

    return null;
  }

  /**
   * Get a knot by ID
   */
  public getKnot(id: string): Knot | null {
    return this.knots[id] || null;
  }

  /**
   * Get all knots in the tree
   */
  public getAllKnots(): Knot[] {
    return Object.values(this.knots);
  }

  /**
   * Get children of a knot
   */
  public getChildren(parentId: string): string[] {
    return this.children[parentId] || [];
  }

  /**
   * Generate a unique ID for knots
   */
  private generateId(): string {
    // Simple ID generation - in practice, this would be more sophisticated
    return `knot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
}