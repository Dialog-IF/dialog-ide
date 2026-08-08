/**
 * VS Code extension entry point.
 * Owns the SkeinService lifecycle, the skein webview, and the run-configuration commands that
 * start/stop a SkeinSession against a Dialog project (see session-runner.ts for the pure logic
 * behind those commands).
 */

import * as vscode from 'vscode';
import {
  EngineType,
  PersistenceManager,
  readProject,
  SkeinService,
  SkeinSession
} from './dialoged/skein';
import {
  DEFAULT_SESSION_ID,
  EngineChoice,
  ENGINE_CHOICES,
  isDgdebugAvailable,
  isValidSessionId,
  listSkeinFiles,
  parseSeed,
  randomSeed,
  resolveProjectRoot,
  sessionConfigFromTree,
  toSessionId
} from './session-runner';

let skeinService: SkeinService | undefined;
let skeinPanel: vscode.WebviewPanel | undefined;
let statusBarItem: vscode.StatusBarItem;

let activeSession: SkeinSession | undefined;
let activeSessionId: string | undefined;
let activeProjectRoot: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  skeinService = new SkeinService({ port: 3000, host: 'localhost' });
  await skeinService.start();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  refreshStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

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

      skeinPanel.webview.html = getWebviewHtml(currentSessionDisplay());

      skeinPanel.onDidDispose(() => {
        skeinPanel = undefined;
      });
    }),
    vscode.commands.registerCommand(
      'dialog-ide.runDefaultSkein',
      withErrorHandling(() => runDefaultSkein(resolveProjectRoot(getWorkspaceRoot())))
    ),
    vscode.commands.registerCommand(
      'dialog-ide.runSkein',
      withErrorHandling(() => runSkeinPicker(resolveProjectRoot(getWorkspaceRoot())))
    ),
    vscode.commands.registerCommand(
      'dialog-ide.newSkein',
      withErrorHandling(() => newSkeinSession(resolveProjectRoot(getWorkspaceRoot())))
    ),
    vscode.commands.registerCommand('dialog-ide.stopSkein', withErrorHandling(stopSkeinCommand))
  );
}

export async function deactivate(): Promise<void> {
  await stopActiveSession();
  await skeinService?.stop();
  skeinService = undefined;
}

function withErrorHandling(action: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await action();
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * "Run Default Skein" - only ever runs an already-existing default.skein, matching dialog-tool's
 * own `dgt skein run` (which aborts rather than creating one implicitly).
 */
async function runDefaultSkein(projectRoot: string): Promise<void> {
  const manager = new PersistenceManager(projectRoot);
  if (!(await manager.sessionExists(DEFAULT_SESSION_ID))) {
    throw new Error(`${DEFAULT_SESSION_ID}.skein does not exist - use "New Skein..." instead.`);
  }
  await runLoadedSession(projectRoot, DEFAULT_SESSION_ID);
}

/**
 * "Run Skein..." - QuickPick among existing .skein files in the project.
 */
async function runSkeinPicker(projectRoot: string): Promise<void> {
  const ids = await listSkeinFiles(projectRoot);
  if (ids.length === 0) {
    throw new Error('No .skein files found in this project - use "New Skein..." to create one.');
  }

  const picked = await vscode.window.showQuickPick(
    ids.map((id) => `${id}.skein`),
    { placeHolder: 'Choose a skein file to run' }
  );
  if (!picked) {
    return;
  }

  await runLoadedSession(projectRoot, toSessionId(picked));
}

async function runLoadedSession(projectRoot: string, sessionId: string): Promise<void> {
  if (!(await confirmStopIfRunning())) {
    return;
  }

  const project = readProject(projectRoot);
  if (!(await isDgdebugAvailable(project.binDir))) {
    throw new Error(
      'dgdebug was not found on PATH (or in binDir). Install the Dialog toolchain or set "binDir" in dialog.json.'
    );
  }

  const manager = new PersistenceManager(projectRoot);
  const tree = await manager.loadSession(sessionId);
  const session = SkeinSession.createLoaded(tree, sessionConfigFromTree(tree, projectRoot));
  await session.start();

  setActiveSession(session, sessionId, projectRoot);
  vscode.window.showInformationMessage(`Running ${sessionId}.skein (${tree.getEngine()})`);
}

/**
 * "New Skein..." - prompts for engine (dgdebug only, for now), seed, and a file name, then
 * creates and immediately persists the new skein, matching dialog-tool's `dgt skein new`.
 */
async function newSkeinSession(projectRoot: string): Promise<void> {
  if (!(await confirmStopIfRunning())) {
    return;
  }

  const engineChoice = await pickEngine();
  if (!engineChoice) {
    return;
  }

  const seedInput = await vscode.window.showInputBox({
    prompt: 'Random seed (leave blank for a random one)',
    validateInput: (value) => {
      if (value.trim() === '') {
        return undefined;
      }
      try {
        parseSeed(value);
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    }
  });
  if (seedInput === undefined) {
    return;
  }
  const seed = seedInput.trim() === '' ? randomSeed() : parseSeed(seedInput);

  const filenameInput = await vscode.window.showInputBox({
    prompt: 'Skein file name',
    value: `${DEFAULT_SESSION_ID}.skein`,
    validateInput: (value) => (isValidSessionId(toSessionId(value)) ? undefined : 'Enter a plain file name, not a path.')
  });
  if (filenameInput === undefined) {
    return;
  }
  const sessionId = toSessionId(filenameInput);

  const manager = new PersistenceManager(projectRoot);
  if (await manager.sessionExists(sessionId)) {
    throw new Error(`${sessionId}.skein already exists - use "Run Skein..." to open it instead.`);
  }

  const project = readProject(projectRoot);
  if (!(await isDgdebugAvailable(project.binDir))) {
    throw new Error(
      'dgdebug was not found on PATH (or in binDir). Install the Dialog toolchain or set "binDir" in dialog.json.'
    );
  }

  const session = SkeinSession.createNew({ engine: engineChoice.engine, seed, projectRoot });
  await session.start();
  await manager.saveSession(session.getTree(), sessionId);

  setActiveSession(session, sessionId, projectRoot);
  vscode.window.showInformationMessage(`Started ${sessionId}.skein (${engineChoice.engine}, seed ${seed})`);
}

async function pickEngine(): Promise<EngineChoice | undefined> {
  for (;;) {
    const picked = await vscode.window.showQuickPick(
      ENGINE_CHOICES.map((choice) => ({
        label: choice.label,
        description: choice.supported ? undefined : 'not yet implemented',
        choice
      })),
      { placeHolder: 'Choose an engine' }
    );
    if (!picked) {
      return undefined;
    }
    if (!picked.choice.supported) {
      vscode.window.showInformationMessage(`${picked.choice.label} isn't implemented yet - choose dgdebug.`);
      continue;
    }
    return picked.choice;
  }
}

async function stopSkeinCommand(): Promise<void> {
  if (!activeSession) {
    vscode.window.showInformationMessage('No skein session is running.');
    return;
  }
  await stopActiveSession();
  vscode.window.showInformationMessage('Skein session stopped.');
}

/**
 * If a session is already running, asks the user whether to stop it before continuing.
 * Returns true when it's safe to proceed (nothing was running, or the user confirmed and it's
 * now stopped); false if the user declined, meaning the caller should abort.
 */
async function confirmStopIfRunning(): Promise<boolean> {
  if (!activeSession) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    `A skein session ("${activeSessionId}.skein") is already running. Stop it and continue?`,
    { modal: true },
    'Stop and Continue'
  );
  if (choice !== 'Stop and Continue') {
    return false;
  }

  await stopActiveSession();
  return true;
}

async function stopActiveSession(): Promise<void> {
  if (!activeSession || !activeSessionId || !activeProjectRoot) {
    return;
  }

  try {
    await new PersistenceManager(activeProjectRoot).saveSession(activeSession.getTree(), activeSessionId);
  } finally {
    await activeSession.stop();
    activeSession = undefined;
    activeSessionId = undefined;
    activeProjectRoot = undefined;
    refreshStatusBar();
    refreshSkeinPanel();
  }
}

function setActiveSession(session: SkeinSession, sessionId: string, projectRoot: string): void {
  activeSession = session;
  activeSessionId = sessionId;
  activeProjectRoot = projectRoot;
  refreshStatusBar();
  refreshSkeinPanel();
}

function refreshStatusBar(): void {
  if (activeSession && activeSessionId) {
    const tree = activeSession.getTree();
    statusBarItem.text = `$(debug-stop) Dialog Skein: ${activeSessionId}.skein (${tree.getEngine()})`;
    statusBarItem.tooltip = `Seed ${tree.getSeed()} - click to open the Skein panel`;
    statusBarItem.command = 'dialog-ide.openSkein';
  } else {
    statusBarItem.text = '$(play) Dialog Skein';
    statusBarItem.tooltip = 'No skein session running - click to run the default skein';
    statusBarItem.command = 'dialog-ide.runDefaultSkein';
  }
}

function refreshSkeinPanel(): void {
  if (!skeinPanel) {
    return;
  }
  skeinPanel.webview.html = getWebviewHtml(currentSessionDisplay());
}

interface ActiveSessionDisplay {
  sessionId: string;
  engine: EngineType;
  seed: number;
}

function currentSessionDisplay(): ActiveSessionDisplay | undefined {
  if (!activeSession || !activeSessionId) {
    return undefined;
  }
  const tree = activeSession.getTree();
  return { sessionId: activeSessionId, engine: tree.getEngine(), seed: tree.getSeed() };
}

/**
 * Placeholder shell until service.ts serves the real Datastar/SSE UI over
 * http://localhost:<port> and this panel is pointed at it instead.
 */
function getWebviewHtml(active: ActiveSessionDisplay | undefined): string {
  const status = active
    ? `<p>Session: <code>${active.sessionId}.skein</code> &middot; Engine: <code>${active.engine}</code> &middot; Seed: <code>${active.seed}</code></p>`
    : `<p>No skein session running. Run <strong>Dialog IDE: Run Default Skein</strong>, <strong>Run Skein...</strong>, or <strong>New Skein...</strong> from the Command Palette.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <title>Dialog Skein</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem; }
    code { background: var(--vscode-textCodeBlock-background); padding: 0.1rem 0.3rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h2>Dialog Skein</h2>
  ${status}
  <p>This panel will host the real Datastar/SSE skein UI once the HTTP server in
     <code>service.ts</code> is implemented.</p>
</body>
</html>`;
}
