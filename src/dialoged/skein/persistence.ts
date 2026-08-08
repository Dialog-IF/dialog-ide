/**
 * Persistence layer for the Skein engine.
 * Handles saving and loading session state to/from files.
 */

import { SkeinTree, WireKnot } from './tree';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Session file format
 */
export interface SessionFile {
  meta: {
    engine: 'dgdebug' | 'frotz' | 'frotz-release';
    seed: number;
    version: string;
    created: string;
    modified: string;
  };
  knots: Record<string, WireKnot>;
}

/**
 * Persistence manager for Skein sessions
 */
export class PersistenceManager {
  private basePath: string;

  constructor(basePath: string = './sessions') {
    this.basePath = basePath;
  }

  /**
   * Save session data to file
   */
  public async saveSession(tree: SkeinTree, sessionId: string): Promise<void> {
    try {
      // Ensure base path exists
      await fs.mkdir(this.basePath, { recursive: true });

      // Convert tree to file format
      const sessionFile: SessionFile = {
        meta: tree.getMetadata(),
        knots: {}
      };

      // Add knots to file format
      const allKnots = tree.getAllKnots();
      for (const knot of allKnots) {
        sessionFile.knots[knot.id] = knot;
      }

      // Write to file
      const filePath = path.join(this.basePath, `${sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(sessionFile, null, 2));

      console.log(`Session ${sessionId} saved successfully to ${filePath}`);
    } catch (error) {
      console.error('Failed to save session:', error);
      throw error;
    }
  }

  /**
   * Load session data from file
   */
  public async loadSession(sessionId: string): Promise<SkeinTree> {
    try {
      const filePath = path.join(this.basePath, `${sessionId}.json`);
      const fileContent = await fs.readFile(filePath, 'utf8');
      const sessionFile: SessionFile = JSON.parse(fileContent);

      // In a real implementation, we would reconstruct the SkeinTree from this data
      // For now, returning an empty tree with metadata

      console.log(`Session ${sessionId} loaded successfully from ${filePath}`);

      // This is a simplified version - in reality this would properly construct a tree
      const engine = sessionFile.meta.engine || 'dgdebug';
      const seed = sessionFile.meta.seed || 12345;

      return new SkeinTree(engine, seed);
    } catch (error) {
      console.error('Failed to load session:', error);
      throw error;
    }
  }

  /**
   * Perform atomic file operations
   */
  public async atomicWrite(filePath: string, content: string): Promise<void> {
    try {
      // Create a temporary file name
      const tempPath = `${filePath}.tmp`;

      // Write to temporary file
      await fs.writeFile(tempPath, content);

      // Atomically move the temporary file to the target location
      await fs.rename(tempPath, filePath);

      console.log(`Atomic write completed for ${filePath}`);
    } catch (error) {
      console.error('Atomic write failed:', error);
      throw error;
    }
  }

  /**
   * Validate data during load
   */
  public validateSessionData(data: any): boolean {
    // Basic validation of session data structure
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check required fields
    if (!data.meta || !data.knots) {
      return false;
    }

    // Additional validation logic would go here

    return true;
  }
}