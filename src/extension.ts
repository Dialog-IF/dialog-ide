/**
 * VS Code extension entry point.
 * Owns the SkeinService lifecycle, the skein webview, and the run-configuration commands that
 * start/stop a SkeinSession against a Dialog project (see session-runner.ts for the pure logic
 * behind those commands).
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  DialogCompileError,
  EngineType,
  PersistenceManager,
  readProject,
  expandSources,
  isFileCoveredBySource,
  resolveCommandPath,
  SkeinService,
  SkeinSession
} from './dialoged/skein';
import { DialogDocumentSymbolProvider } from './dialog-symbol-provider';
import { DialogWorkspaceWatcher } from './dialog-workspace-watcher';
import { DialogWorkspaceSymbolProvider } from './dialog-workspace-symbol-provider';
import { DialogSourceDecorationProvider } from './dialog-source-decoration-provider';
import { addSourceToDialogJson, toDialogJsonPath, SOURCE_CATEGORIES } from './dialog-source-coverage';
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

// Set once deactivate() starts. By the time it runs, VS Code has already begun tearing down this
// extension's UI contributions (statusBarItem included, despite it being disposed via
// context.subscriptions rather than here) - touching them past that point throws "Trying to add a
// disposable to a DisposableStore that has already been disposed of" from deep inside the
// extension host. refreshStatusBar/refreshSkeinPanel check this and no-op, since nothing is left
// to see the update anyway.
let deactivating = false;

// Squiggly + Problems-panel entry for the source location of the most recent DialogCompileError
// (see session.ts's throw sites) - dialog-tool's equivalent was a modal dialog; a real editor
// diagnostic is the more native way to surface "here's what's wrong and where" in VS Code.
// Cleared by clearCompileErrorDiagnostics whenever anything about the session succeeds again
// (session.ts's onChange only ever fires on a successful mutation - see setActiveSession).
let compileErrorDiagnostics: vscode.DiagnosticCollection;

function clearCompileErrorDiagnostics(): void {
  compileErrorDiagnostics?.clear();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  compileErrorDiagnostics = vscode.languages.createDiagnosticCollection('dialog-compile-error');
  context.subscriptions.push(compileErrorDiagnostics);

  skeinService = new SkeinService({
    port: 0,
    host: 'localhost',
    mediaRoot: path.join(context.extensionPath, 'media'),
    grammarPath: resolveDialogGrammarPath(),
    onCompileError: (error) => {
      handleCompileError(error).catch((handlerError) => {
        console.error('Failed to report compile error:', handlerError);
      });
    },
    // VS Code doesn't auto-show a newly contributed panel-area view - without this, a user has
    // to discover it manually (via the panel's own "Views" menu) the first time. Revealing it
    // whenever a trace is actually requested means it just appears exactly when it becomes
    // useful, not on every activation (which would fight with however the user has their panel
    // laid out on every reload). '<viewId>.focus' is VS Code's own auto-generated command for
    // any contributed view - if this ever rejects, the view contribution itself is broken, so
    // that's worth logging rather than swallowing silently.
    onTraceRequested: () => {
      vscode.commands.executeCommand('dialogIdeTraceView.focus').then(undefined, (error) => {
        console.error('Failed to reveal the Trace view:', error);
      });
    }
  });
  await skeinService.start();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  refreshStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dialogIdeTraceView', new TraceViewProvider(), {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'dialog' },
      new DialogDocumentSymbolProvider()
    )
  );

  // Shared across every feature that needs to react to Dialog source changes (see
  // DialogWorkspaceWatcher's own doc comment) - the workspace symbol provider below and the
  // dgdebug-restart wiring further down both subscribe to this one instance rather than each
  // standing up their own vscode.FileSystemWatcher.
  const workspaceWatcher = new DialogWorkspaceWatcher(getWorkspaceRoot());
  const workspaceSymbolProvider = new DialogWorkspaceSymbolProvider(workspaceWatcher);
  context.subscriptions.push(
    workspaceWatcher,
    workspaceSymbolProvider,
    vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
  );

  const sourceDecorationProvider = new DialogSourceDecorationProvider(getWorkspaceRoot);
  context.subscriptions.push(
    sourceDecorationProvider,
    vscode.window.registerFileDecorationProvider(sourceDecorationProvider)
  );

  // A .dg source file or dialog.json changing on disk means the active session's live dgdebug
  // process may now be running against stale sources - mark it so runCommand forces a restart
  // before its next command (see SkeinSession.markSourcesChanged's doc comment). Reads the
  // module-level `activeSession` at call time, not capture time, so this is a no-op whenever no
  // session is running and always targets whichever session is active when a file changes.
  context.subscriptions.push(
    workspaceWatcher.onDidChangeFiles((event) => {
      activeSession?.markSourcesChanged();
      if (event.type === 'create' || event.type === 'delete') {
        sourceDecorationProvider.refresh([event.filePath]);
      }
      if (event.type === 'create') {
        warnIfUncoveredSource(getWorkspaceRoot(), event.filePath).catch((error) => {
          console.error('Failed to check dialog.json source coverage:', error);
        });
      }
    }),
    workspaceWatcher.onDidChangeProjectConfig(() => {
      activeSession?.markSourcesChanged();
      sourceDecorationProvider.refresh(workspaceWatcher.listFiles());
    })
  );

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
    ),
    vscode.commands.registerCommand(
      'dialog-ide.addSourceToProject',
      withErrorHandling((filePath?: string) =>
        addSourceToProject(resolveProjectRoot(getWorkspaceRoot()), filePath ?? activeEditorDgFilePath())
      )
    )
  );
}

export async function deactivate(): Promise<void> {
  deactivating = true;
  await stopActiveSession();
  await skeinService?.stop();
  skeinService = undefined;
}

function withErrorHandling<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await action(...args);
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
  if (!(await runSessionStep(() => session.start()))) {
    return;
  }

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
    // A compile error here (the session is already active, just possibly stale/behind) is left
    // for the user to fix and retry via Replay All - not fatal to the session the way one during
    // start() is, so this deliberately doesn't tear anything down on failure.
    await runSessionStep(() => session.replayAll());
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
  if (!(await runSessionStep(() => session.start()))) {
    return;
  }
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
 * Warns (via a dismissible toast, not a modal) when a newly created .dg file isn't covered by any
 * of dialog.json's declared sources - it would otherwise silently never get compiled/loaded, with
 * no error to explain why. Silently does nothing when there's no workspace, the setting is off,
 * or dialog.json is missing/invalid (readProject already logs/throws for those elsewhere; this is
 * just a nudge, not validation, so it has nothing useful to say in that case).
 */
async function warnIfUncoveredSource(rootDir: string | undefined, filePath: string): Promise<void> {
  if (!rootDir || !vscode.workspace.getConfiguration('dialog-ide').get<boolean>('warnOnUncoveredSource', true)) {
    return;
  }

  let project;
  try {
    project = readProject(rootDir);
  } catch {
    return;
  }

  if (isFileCoveredBySource(project, filePath)) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `${path.basename(filePath)} isn't part of any dialog.json source - it won't be compiled.`,
    'Add to dialog.json'
  );
  if (choice === 'Add to dialog.json') {
    await vscode.commands.executeCommand('dialog-ide.addSourceToProject', filePath);
  }
}

function activeEditorDgFilePath(): string | undefined {
  const document = vscode.window.activeTextEditor?.document;
  return document && document.fileName.endsWith('.dg') ? document.fileName : undefined;
}

/**
 * Adds `filePath` into one of dialog.json's four source categories, prompting via QuickPick for
 * which one - never guesses, since a wrong-category guess (e.g. dropping a real source into
 * `test`) would silently exclude it from normal builds. Invoked either with a known filePath (the
 * "not covered" warning toast's action button, or the Explorer decoration's uncovered-file badge)
 * or from the Command Palette against the active editor (see activeEditorDgFilePath).
 */
async function addSourceToProject(projectRoot: string, filePath: string | undefined): Promise<void> {
  if (!filePath) {
    throw new Error('No .dg file to add - open one first, or use this from the "not covered by dialog.json" warning.');
  }

  const picked = await vscode.window.showQuickPick(
    SOURCE_CATEGORIES.map(({ category, description }) => ({ label: category, description, category })),
    { placeHolder: 'Add to which dialog.json source category?' }
  );
  if (!picked) {
    return;
  }

  const dialogJsonPath = path.join(projectRoot, 'dialog.json');
  const relativePath = toDialogJsonPath(projectRoot, filePath);
  addSourceToDialogJson(dialogJsonPath, picked.category, relativePath);
  vscode.window.showInformationMessage(`Added ${relativePath} to dialog.json's "${picked.category}" sources.`);
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

  activeSession.offChange(clearCompileErrorDiagnostics);
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
  session.onChange(clearCompileErrorDiagnostics);
  refreshStatusBar();
  ensureSkeinPanel();
  refreshSkeinPanel();
}

/**
 * Runs a session action that might hit a DialogCompileError - session.start()/replayAll() are
 * the only session calls extension.ts makes directly rather than through service.ts's own action
 * handlers (see service.ts's reportIfCompileError for the same reaction wired up there). Reports
 * the error and returns false when that happened, so the caller can bail out of whatever setup
 * was still pending without also getting withErrorHandling's generic error toast; true otherwise.
 */
async function runSessionStep(action: () => Promise<void>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    if (error instanceof DialogCompileError) {
      await handleCompileError(error);
      return false;
    }
    throw error;
  }
}

/**
 * Reacts to a DialogCompileError (a fresh dgdebug launch aborted while re-parsing the project's
 * source - see session.ts's throw sites) by opening the offending file and annotating the error
 * onto it as a real editor diagnostic - squiggly underline plus a Problems-panel entry - rather
 * than dialog-tool's old modal dialog. error.filePath is already absolute (project.ts's
 * expandSources only ever hands dgdebug absolute paths), but a relative fallback is kept here in
 * case a future dgdebug/dialogc version ever reports one differently.
 */
async function handleCompileError(error: DialogCompileError): Promise<void> {
  vscode.window.showErrorMessage(`Dialog compile error: ${error.message}`);

  if (!error.filePath) {
    compileErrorDiagnostics.clear();
    return;
  }

  const fullPath = path.isAbsolute(error.filePath)
    ? error.filePath
    : path.join(activeProjectRoot ?? '', error.filePath);

  try {
    const document = await vscode.workspace.openTextDocument(fullPath);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const lineIndex = Math.min(Math.max(0, (error.line ?? 1) - 1), document.lineCount - 1);
    const range = document.lineAt(lineIndex).range;

    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    const diagnostic = new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = 'dialog';
    compileErrorDiagnostics.set(document.uri, [diagnostic]);
  } catch (openError) {
    console.error('Failed to open compile-error source location:', openError);
    compileErrorDiagnostics.clear();
  }
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
  if (deactivating) {
    return;
  }
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
  if (deactivating || !skeinPanel) {
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

/**
 * Resolves the installed dialog-language-support extension's real TextMate grammar to a plain
 * file path, handed down to SkeinService/syntax.ts for the trace panel's hover-preview snippet
 * coloring (see syntax.ts's own doc comment for why this needs the vscode API - and therefore
 * has to happen here, not in the vscode-agnostic skein/ layer - while the actual tokenizing
 * doesn't). Safe to call synchronously in activate(): the extension is declared as an
 * extensionDependencies entry (package.json), which guarantees VS Code activates it first.
 * Returns undefined (falling back to plain, uncolored snippets) only if that extension somehow
 * isn't installed/active.
 */
function resolveDialogGrammarPath(): string | undefined {
  const grammarExtension = vscode.extensions.getExtension('sideburns3000.dialog-language-support');
  return grammarExtension ? path.join(grammarExtension.extensionPath, 'syntaxes', 'dialog.tmLanguage.json') : undefined;
}

function createNonce(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Opens (or focuses an already-open tab for) file at the given 1-indexed line - the trace
 * panel's click-to-source affordance (see media/js/trace.js's sk.trace.openSource, forwarded
 * here by TraceViewProvider's onDidReceiveMessage). file is relative to the active session's
 * project root, matching trace.ts's parseSource convention (the same convention dgdebug's own
 * trace output uses).
 */
async function openSourceAtLine(file: string, line: number): Promise<void> {
  if (!activeProjectRoot) {
    return;
  }
  const fullPath = path.isAbsolute(file) ? file : path.join(activeProjectRoot, file);
  const document = await vscode.workspace.openTextDocument(fullPath);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/**
 * Provider for the native "Trace" panel-area view (package.json's viewsContainers.panel/views -
 * a real tab beside Terminal/Output/Debug Console, per the approved trace-mode design). Same
 * iframe-into-the-local-HTTP-service approach as the main skein WebviewPanel (getWebviewHtml
 * above), pointed at /trace instead of / - except this one actually needs a postMessage bridge
 * back to the extension host (unlike that one, which runs no JS at all): the trace page's own
 * click handler can't call vscode.window.showTextDocument directly (webview content has no
 * vscode API), so it posts {type:'openSource', file, line} up to this wrapper's window, which
 * forwards it to the extension host via acquireVsCodeApi().postMessage.
 */
class TraceViewProvider implements vscode.WebviewViewProvider {
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getTraceWebviewHtml();

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      const msg = message as { type?: string; file?: string; line?: number };
      if (msg?.type === 'openSource' && typeof msg.file === 'string' && typeof msg.line === 'number') {
        openSourceAtLine(msg.file, msg.line).catch((error) => {
          vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        });
      }
    });
  }
}

function getTraceWebviewHtml(): string {
  const serviceUrl = skeinService ? `http://localhost:${skeinService.getPort()}/trace` : undefined;
  const body = serviceUrl ? `<iframe src="${serviceUrl}"></iframe>` : `<p>Skein service is not running.</p>`;
  const nonce = createNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src http://localhost:*; child-src http://localhost:*;" />
  <title>Trace</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    body:not(:has(iframe)) { padding: 1rem; }
    iframe { display: block; width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  ${body}
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    window.addEventListener('message', (event) => {
      vscodeApi.postMessage(event.data);
    });
  </script>
</body>
</html>`;
}
