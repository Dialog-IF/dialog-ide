/**
 * VS Code extension entry point.
 * Owns the SkeinService lifecycle, the skein webview, and the run-configuration commands that
 * start/stop a SkeinSession against a Dialog project (see session-runner.ts for the pure logic
 * behind those commands).
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  EngineType,
  PersistenceManager,
  readProject,
  expandSources,
  resolveCommandPath,
  SkeinService,
  SkeinSession
} from './dialoged/skein';
import {
  DEFAULT_SESSION_ID,
  EngineChoice,
  ENGINE_CHOICES,
  debugTerminalShellArgs,
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
  skeinService = new SkeinService({
    port: 0,
    host: 'localhost',
    mediaRoot: path.join(context.extensionPath, 'media')
  });
  await skeinService.start();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  refreshStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('dialog-ide.openSkein', () => ensureSkeinPanel()),
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
    vscode.commands.registerCommand('dialog-ide.stopSkein', withErrorHandling(stopSkeinCommand)),
    vscode.commands.registerCommand('dialog-ide.saveSkein', withErrorHandling(saveActiveSession)),
    vscode.commands.registerCommand(
      'dialog-ide.debugInTerminal',
      withErrorHandling(() => debugInTerminal(resolveProjectRoot(getWorkspaceRoot())))
    )
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
  const session = SkeinSession.createLoaded(tree, sessionConfigFromTree(tree, projectRoot), skeinService);
  await session.start();

  // Wire up the panel/status bar before replaying so the loaded transcript is on screen right
  // away, with the replay's progress notification and subsequent SSE updates layering on top of
  // an already-visible window - rather than leaving the user staring at nothing (or the previous
  // session) until the replay finishes.
  setActiveSession(session, sessionId, projectRoot);
  vscode.window.showInformationMessage(`Running ${sessionId}.skein (${tree.getEngine()})`);

  // start() only ever validates knot 0's banner - the process otherwise sits at the root even
  // though the transcript immediately shows the loaded active spine, so without this the process
  // wouldn't actually catch up until the user manually clicked Replay All or typed a command. This
  // is a full replayAll (every leaf in the tree, not just the active spine) - a fresh load is
  // exactly when picking up .dg source edits across every explored branch matters most, before the
  // user has looked at any of them. Skip it entirely when the loaded skein never went past the
  // root - nothing to replay, and replayAll would otherwise force a pointless extra process
  // restart.
  const activeKnotId = session.getTree().getActiveKnotId();
  if (activeKnotId !== null && activeKnotId !== 0) {
    await session.replayAll();
  }
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

  const session = SkeinSession.createNew({ engine: engineChoice.engine, seed, projectRoot }, skeinService);
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
 * Explicit save - the only way a session's tree is ever written to its .skein file. Matches
 * dialog-tool's own model (an explicit Save action, not autosave-on-stop): stopActiveSession
 * never persists on its own, so switching/stopping sessions without saving first discards
 * in-memory changes, same as dialog-tool. Reachable from the Command Palette and from the
 * webview's navbar Save button (service.ts's POST /actions/save, wired via the onSave callback
 * passed to skeinService.setActiveSession).
 */
async function saveActiveSession(): Promise<void> {
  if (!activeSession || !activeSessionId || !activeProjectRoot) {
    vscode.window.showInformationMessage('No skein session is running.');
    return;
  }
  await new PersistenceManager(activeProjectRoot).saveSession(activeSession.getTree(), activeSessionId);
  vscode.window.showInformationMessage(`Saved ${activeSessionId}.skein`);
}

/**
 * Opens a real, unmanaged interactive dgdebug session in a VS Code terminal - not tied to any
 * tracked skein session or tree, matching dialog-tool's own `dgt debug` command. No --tag-lines,
 * since nothing here needs to parse the output - VS Code's terminal owns a real PTY and dgdebug
 * behaves exactly as it would in any other terminal.
 */
async function debugInTerminal(projectRoot: string): Promise<void> {
  const project = readProject(projectRoot);
  if (!(await isDgdebugAvailable(project.binDir))) {
    throw new Error(
      'dgdebug was not found on PATH (or in binDir). Install the Dialog toolchain or set "binDir" in dialog.json.'
    );
  }

  const sourceFiles = expandSources(project, { debug: true, target: 'dgdebug' });
  const terminal = vscode.window.createTerminal({
    name: 'Dialog Debugger',
    shellPath: resolveCommandPath(project.binDir, 'dgdebug'),
    shellArgs: debugTerminalShellArgs(sourceFiles)
  });
  terminal.show();
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
    `A skein session ("${activeSessionId}.skein") is already running. Stopping it discards any unsaved changes - save first if you want to keep them. Stop and continue?`,
    { modal: true },
    'Stop and Continue'
  );
  if (choice !== 'Stop and Continue') {
    return false;
  }

  await stopActiveSession();
  return true;
}

/**
 * Never persists - matches dialog-tool's own model, where stopping/replacing a session doesn't
 * imply the user wanted to save it. saveActiveSession is the only path that writes to the
 * .skein file; call it explicitly first if the in-memory tree should survive this stop.
 */
async function stopActiveSession(): Promise<void> {
  if (!activeSession) {
    return;
  }

  await activeSession.stop();
  activeSession = undefined;
  activeSessionId = undefined;
  activeProjectRoot = undefined;
  skeinService?.setActiveSession(undefined, undefined);
  refreshStatusBar();
  refreshSkeinPanel();
}

function setActiveSession(session: SkeinSession, sessionId: string, projectRoot: string): void {
  activeSession = session;
  activeSessionId = sessionId;
  activeProjectRoot = projectRoot;
  skeinService?.setActiveSession(session, sessionId, saveActiveSession);
  refreshStatusBar();
  ensureSkeinPanel();
  refreshSkeinPanel();
}

/**
 * Creates the skein webview panel if it doesn't exist yet, or reveals it if it does - shared by
 * the explicit "Open Skein" command and by setActiveSession, so starting/loading a session always
 * shows its panel rather than requiring a separate "Open Skein" afterwards.
 */
function ensureSkeinPanel(): vscode.WebviewPanel {
  if (skeinPanel) {
    skeinPanel.reveal(vscode.ViewColumn.Beside);
    return skeinPanel;
  }

  skeinPanel = vscode.window.createWebviewPanel(
    'dialogIdeSkein',
    panelTitle(currentSessionDisplay()),
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  skeinPanel.webview.html = getWebviewHtml(currentSessionDisplay());

  skeinPanel.onDidDispose(() => {
    skeinPanel = undefined;
    stopActiveSession().catch((error) => {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    });
  });

  return skeinPanel;
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
  const display = currentSessionDisplay();
  skeinPanel.title = panelTitle(display);
  skeinPanel.webview.html = getWebviewHtml(display);
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

/** The panel's own editor-tab title - identifies which .skein file is open, same as any other tab. */
function panelTitle(active: ActiveSessionDisplay | undefined): string {
  return active ? `${active.sessionId}.skein` : 'Skein';
}

/**
 * Embeds the real (read-only, for now - see the Phase 1 plan) skein transcript via
 * <iframe src="http://localhost:PORT">, served by SkeinService and styled with dialog-tool's
 * own vendored Tailwind/DaisyUI CSS. The CSP's frame-src/connect-src allow only
 * http://localhost:* - the iframe's own document still needs "unsafe-inline" style for
 * whatever CSS it carries, but that's scoped to the iframe's origin, not this outer page.
 *
 * Which file is open lives in the panel's own tab title (panelTitle) now, not in an in-page
 * heading or engine/seed line - so the iframe is the entire page, sized to fill it exactly
 * rather than capped at a fraction of the viewport. Session/engine/seed identity and the
 * "no session running" guidance both already render inside the iframe itself (render.ts's
 * navbar, service.ts's NO_ACTIVE_SESSION_FRAGMENT), so nothing is lost by not duplicating
 * either one out here.
 */
function getWebviewHtml(active: ActiveSessionDisplay | undefined): string {
  const serviceUrl = skeinService ? `http://localhost:${skeinService.getPort()}/` : undefined;
  const body = serviceUrl
    ? `<iframe src="${serviceUrl}"></iframe>`
    : `<p>Skein service is not running.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src http://localhost:*; child-src http://localhost:*;" />
  <title>${panelTitle(active)}</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    body:not(:has(iframe)) { padding: 1rem; }
    iframe { display: block; width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}
