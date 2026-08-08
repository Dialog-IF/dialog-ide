/**
 * Configuration for the Dialog IDE and Skein engine
 */

export interface ProjectConfig {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
}

export interface SkeinConfig {
  // Process management settings
  process: {
    timeout: number; // milliseconds
    maxRetries: number;
    env?: Record<string, string>;
  };

  // Tree settings
  tree: {
    maxKnots: number;
    memoryLimit: number; // MB
  };

  // Web service settings
  service: {
    port: number;
    host: string;
    enableSse: boolean;
  };

  // File format settings
  fileFormat: {
    version: string;
    encoding: 'utf8' | 'ascii';
    compression: 'none' | 'gzip';
  };
}

// Default configuration
export const defaultConfig: SkeinConfig = {
  process: {
    timeout: 30000,
    maxRetries: 3
  },
  tree: {
    maxKnots: 10000,
    memoryLimit: 100
  },
  service: {
    port: 3000,
    host: 'localhost',
    enableSse: true
  },
  fileFormat: {
    version: '1.0.0',
    encoding: 'utf8',
    compression: 'none'
  }
};

// Project metadata
export const projectConfig: ProjectConfig = {
  name: 'Dialog IDE',
  version: '1.0.0',
  description: 'IDE for Dialog interactive fiction development with Skein engine',
  author: 'Howard Lewis Ship',
  license: 'MIT'
};