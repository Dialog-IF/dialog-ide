/**
 * vscode.WorkspaceSymbolProvider adapter - powers Cmd+T/Ctrl+T "Go to Symbol in Workspace" for
 * Dialog projects, backed by dialog-symbol-index.ts's pure index and kept current via
 * dialog-workspace-watcher.ts. Registered in extension.ts's activate(), same as
 * dialog-symbol-provider.ts's per-file DocumentSymbolProvider.
 */

import * as vscode from 'vscode';
import { DgFileEvent, DialogWorkspaceWatcher } from './dialog-workspace-watcher';
import { DialogPosition } from './dialog-outline';
import { DialogSymbolIndex, IndexedSymbol, readIndexedFile } from './dialog-symbol-index';

// Bounds concurrent open file handles while building the initial index of a large project,
// rather than firing off hundreds of fs.readFile calls at once.
const BATCH_SIZE = 32;

function toPosition(position: DialogPosition): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

function toSymbolInformation(symbol: IndexedSymbol): vscode.SymbolInformation {
  const kind = symbol.kind === 'topic' ? vscode.SymbolKind.Class : vscode.SymbolKind.Function;
  const range = new vscode.Range(
    toPosition(symbol.selectionRange.start),
    toPosition(symbol.selectionRange.end)
  );
  const location = new vscode.Location(vscode.Uri.file(symbol.filePath), range);
  return new vscode.SymbolInformation(symbol.name, kind, symbol.containerName, location);
}

async function loadInBatches(filePaths: string[], index: DialogSymbolIndex): Promise<void> {
  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          index.setFile(filePath, await readIndexedFile(filePath));
        } catch (error) {
          console.error(`Failed to index ${filePath}:`, error);
        }
      })
    );
  }
}

export class DialogWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider, vscode.Disposable {
  private readonly index = new DialogSymbolIndex();
  private readonly watcher: DialogWorkspaceWatcher;
  private readonly watcherSubscription: vscode.Disposable;
  private updateChain: Promise<void>;
  public readonly ready: Promise<void>;

  constructor(rootDir: string | undefined) {
    this.watcher = new DialogWorkspaceWatcher(rootDir);
    this.watcherSubscription = this.watcher.onDidChangeFiles((event) => this.queueFileEvent(event));
    this.ready = this.initialize();
    this.updateChain = this.ready;
  }

  async provideWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
    await this.ready;
    const results: vscode.SymbolInformation[] = [];
    for (const symbol of this.index.search(query)) {
      try {
        results.push(toSymbolInformation(symbol));
      } catch (error) {
        // One malformed symbol (e.g. an out-of-range position from a stale/mid-edit parse)
        // should never take out the whole result list - drop just this entry.
        console.error(`Failed to build a workspace symbol for "${symbol.name}" in ${symbol.filePath}:`, error);
      }
    }
    return results;
  }

  dispose(): void {
    this.watcherSubscription.dispose();
    this.watcher.dispose();
  }

  private async initialize(): Promise<void> {
    await this.watcher.ready;
    await loadInBatches(this.watcher.listFiles(), this.index);
  }

  // Every event is chained after the initial build and after any event queued before it, so a
  // delete landing mid-scan can never be clobbered by a still-in-flight initial read of the same
  // file resolving afterward.
  private queueFileEvent(event: DgFileEvent): void {
    this.updateChain = this.updateChain.catch(() => undefined).then(() => this.applyFileEvent(event));
  }

  private async applyFileEvent(event: DgFileEvent): Promise<void> {
    if (event.type === 'delete') {
      this.index.removeFile(event.filePath);
      return;
    }
    try {
      this.index.setFile(event.filePath, await readIndexedFile(event.filePath));
    } catch (error) {
      console.error(`Failed to reindex ${event.filePath}:`, error);
    }
  }
}
