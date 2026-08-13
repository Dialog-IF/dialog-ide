/**
 * Explorer-badge signal for a .dg file that dialog.json doesn't currently declare as a source -
 * survives a dismissed "not covered" toast (extension.ts's warnIfUncoveredSource) and catches
 * files that become uncovered later (e.g. dialog.json edited to drop a directory entry). Mirrors
 * CMake Tools' own "file not in CMakeLists.txt" dimmed-badge convention rather than repeating an
 * interrupting prompt for every file, every time.
 */

import * as vscode from 'vscode';
import { readProject, isFileCoveredBySource } from './dialoged/skein';

export class DialogSourceDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  public readonly onDidChangeFileDecorations = this.emitter.event;

  constructor(private readonly getRootDir: () => string | undefined) {}

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!uri.fsPath.endsWith('.dg')) {
      return undefined;
    }
    if (!vscode.workspace.getConfiguration('dialog-ide').get<boolean>('warnOnUncoveredSource', true)) {
      return undefined;
    }

    const rootDir = this.getRootDir();
    if (!rootDir) {
      return undefined;
    }

    try {
      const project = readProject(rootDir);
      if (isFileCoveredBySource(project, uri.fsPath)) {
        return undefined;
      }
    } catch {
      // Missing/invalid dialog.json - nothing useful to say here, warnIfUncoveredSource's toast
      // path already covers that case's own notification.
      return undefined;
    }

    return {
      badge: '!',
      tooltip: 'Not covered by any dialog.json source - this file will not be compiled.',
      color: new vscode.ThemeColor('list.warningForeground')
    };
  }

  /** Re-evaluates the decoration for exactly these files - pass every currently known .dg file when dialog.json itself changes. */
  refresh(filePaths: string[]): void {
    this.emitter.fire(filePaths.map((filePath) => vscode.Uri.file(filePath)));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
