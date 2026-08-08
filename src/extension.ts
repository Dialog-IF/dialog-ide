/**
 * VS Code extension entry point.
 * Owns the SkeinService lifecycle and the webview that hosts the Skein UI.
 */

import * as vscode from 'vscode';
import { SkeinService } from './dialoged/skein';

let skeinService: SkeinService | undefined;
let skeinPanel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  skeinService = new SkeinService({ port: 3000, host: 'localhost' });
  await skeinService.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('dialog-ide.openSkein', () => {
      if (skeinPanel) {
        skeinPanel.reveal(vscode.ViewColumn.Beside);
        return;
      }

      skeinPanel = vscode.window.createWebviewPanel(
        'dialogIdeSkein',
        'Dialog Skein',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      skeinPanel.webview.html = getWebviewHtml(skeinService!.isRunningService());

      skeinPanel.onDidDispose(() => {
        skeinPanel = undefined;
      });
    })
  );
}

export async function deactivate(): Promise<void> {
  await skeinService?.stop();
  skeinService = undefined;
}

/**
 * Placeholder shell until service.ts serves the real Datastar/SSE UI over
 * http://localhost:<port> and this panel is pointed at it instead.
 */
function getWebviewHtml(serviceRunning: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <title>Dialog Skein</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem; }
  </style>
</head>
<body>
  <h2>Dialog Skein</h2>
  <p>Skein service running: ${serviceRunning}</p>
  <p>This panel will host the Datastar/SSE skein UI once the HTTP server in
     <code>service.ts</code> is implemented.</p>
</body>
</html>`;
}
