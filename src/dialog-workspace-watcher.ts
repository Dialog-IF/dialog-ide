/**
 * Reusable vscode.FileSystemWatcher wrapper over a project's .dg source files (plus its
 * dialog.json project descriptor, which can add/remove/reorder which .dg files are actually
 * loaded) - not specific to any one feature. dialog-workspace-symbol-provider.ts is the first
 * consumer, but other editor-wide features that need to react to Dialog source changes should
 * subscribe here rather than standing up their own watcher. Deliberately minimal: reports only
 * file paths/change type, no content caching - each consumer decides what it needs from a file
 * once it hears about a change. dialog.json changes are reported through a separate event
 * (onDidChangeProjectConfig) rather than folded into onDidChangeFiles's DgFileEvent stream,
 * since dialog.json isn't itself a .dg source and existing consumers assume every DgFileEvent
 * path is one.
 */

import * as vscode from 'vscode';
import { readProject, expandSources } from './dialoged/skein/project';

export type DgFileChangeType = 'change' | 'create' | 'delete';

export interface DgFileEvent {
  type: DgFileChangeType;
  filePath: string;
}

/**
 * Resolves the .dg files that belong to `rootDir`'s project. Prefers dialog.json's declared
 * sources (main+test+debug+library, matching what dgdebug/dialogc would actually load) so stray
 * or vendored .dg files elsewhere in the workspace don't pollute results; falls back to a broad
 * workspace glob when dialog.json is missing/invalid (or rootDir is undefined) so the feature
 * degrades gracefully instead of finding nothing.
 */
async function resolveDgFiles(rootDir: string | undefined): Promise<string[]> {
  if (rootDir) {
    try {
      const project = readProject(rootDir);
      return expandSources(project, { test: true, debug: true });
    } catch {
      // Missing/invalid dialog.json - fall through to the broad glob below.
    }
  }

  const pattern = rootDir ? new vscode.RelativePattern(rootDir, '**/*.dg') : '**/*.dg';
  const uris = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git}/**');
  return uris.map((uri) => uri.fsPath);
}

export class DialogWorkspaceWatcher implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<DgFileEvent>();
  private readonly configEmitter = new vscode.EventEmitter<DgFileChangeType>();
  private readonly watcher: vscode.FileSystemWatcher | undefined;
  private readonly configWatcher: vscode.FileSystemWatcher | undefined;
  private files: string[] = [];
  public readonly ready: Promise<void>;

  constructor(rootDir: string | undefined) {
    this.ready = this.initialize(rootDir);

    if (rootDir) {
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(rootDir, '**/*.dg')
      );
      this.watcher.onDidChange((uri) => this.emit('change', uri));
      this.watcher.onDidCreate((uri) => this.emit('create', uri));
      this.watcher.onDidDelete((uri) => this.emit('delete', uri));

      this.configWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(rootDir, 'dialog.json')
      );
      this.configWatcher.onDidChange(() => this.configEmitter.fire('change'));
      this.configWatcher.onDidCreate(() => this.configEmitter.fire('create'));
      this.configWatcher.onDidDelete(() => this.configEmitter.fire('delete'));
    }
  }

  listFiles(): string[] {
    return this.files;
  }

  onDidChangeFiles(listener: (event: DgFileEvent) => void): vscode.Disposable {
    return this.emitter.event(listener);
  }

  /** Fires whenever this project's dialog.json is created, changed, or deleted. */
  onDidChangeProjectConfig(listener: (type: DgFileChangeType) => void): vscode.Disposable {
    return this.configEmitter.event(listener);
  }

  dispose(): void {
    this.watcher?.dispose();
    this.configWatcher?.dispose();
    this.emitter.dispose();
    this.configEmitter.dispose();
  }

  // Merges the resolved snapshot with anything that already arrived via an early watcher event
  // (possible since the watcher is live from the constructor, before this resolves) rather than
  // overwriting - a change/create landing mid-scan should never be silently dropped.
  private async initialize(rootDir: string | undefined): Promise<void> {
    const discovered = await resolveDgFiles(rootDir);
    const merged = new Set(this.files);
    discovered.forEach((filePath) => merged.add(filePath));
    this.files = Array.from(merged);
  }

  private emit(type: DgFileChangeType, uri: vscode.Uri): void {
    const filePath = uri.fsPath;
    if (type === 'delete') {
      this.files = this.files.filter((existing) => existing !== filePath);
    } else if (!this.files.includes(filePath)) {
      this.files.push(filePath);
    }
    this.emitter.fire({ type, filePath });
  }
}
