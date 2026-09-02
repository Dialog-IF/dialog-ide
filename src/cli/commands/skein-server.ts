/**
 * Shared engine for `dgbuild new-skein` / `open-skein` (see new-skein.ts / open-skein.ts): stands
 * up a real SkeinService on localhost and drives a live SkeinSession behind it, so the full
 * interactive Skein UI - the same one the VS Code extension embeds - runs from a plain browser with
 * no editor. Headless counterpart of extension.ts's SkeinService wiring; the interactive HTTP
 * routes (send-command, bless, replay, trace, save, quit, …) already exist on SkeinService and need
 * nothing new here.
 *
 * `startSkeinServer` is deliberately non-blocking and installs no signal handlers, so a test can
 * start and stop it inside one `it()`. `runInteractiveSkein` is the command-facing wrapper that
 * prints the URL, opens a browser, and blocks until the in-UI Quit finishes or Ctrl+C arrives.
 */

import { spawn } from 'child_process';
import {
  DialogCompileError,
  PersistenceManager,
  SkeinService,
  SkeinSession,
  SkeinTree,
  readProject
} from '../../dialoged/skein';
import {
  DEFAULT_SESSION_ID,
  isDgdebugAvailable,
  isValidSessionId,
  randomSeed,
  sessionConfigFromTree,
  toSessionId
} from '../../session-runner';
import {
  CliError,
  resolveCliBundledBinDir,
  resolveCliGrammarPath,
  resolveCliMediaRoot,
  resolveCliPatchSourcePath,
  withQuietLogging
} from '../context';

// --- CLI option parsing, shared by new-skein / open-skein (pure, unit-tested) -------------------

/** `--theme` -> 'light' (default) | 'dark'; anything else is a CliError. */
export function parseThemeOption(value: string | undefined): 'light' | 'dark' {
  if (value === undefined || value === 'light') {
    return 'light';
  }
  if (value === 'dark') {
    return 'dark';
  }
  throw new CliError(`"${value}" is not a valid theme - use "light" or "dark".`);
}

/** `--port` -> 0 (default: OS-assigned) or a valid TCP port; anything else is a CliError. */
export function parsePortOption(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CliError(`"${value}" is not a valid port - use a whole number from 0 to 65535.`);
  }
  return port;
}

/** A skein name/filename -> its session id, guarded against path traversal; default `default`. */
export function resolveSkeinSessionId(nameOrFile: string | undefined): string {
  const sessionId = toSessionId(nameOrFile ?? DEFAULT_SESSION_ID);
  if (!isValidSessionId(sessionId)) {
    throw new CliError(`"${nameOrFile}" is not a valid skein name.`);
  }
  return sessionId;
}

export interface StartSkeinServerParams {
  projectRoot: string;
  sessionId: string;
  mode: 'new' | 'open';
  /** new only; defaults to a random seed */
  seed?: number;
  theme: 'light' | 'dark';
  /** 0 => OS-assigned free port */
  port: number;
  verbose?: boolean;
}

export interface StartedSkeinServer {
  url: string;
  port: number;
  /** Resolves once the in-UI Quit button has run its server-side steps (POST /actions/quit). */
  waitForQuit: Promise<void>;
  /** Whether the skein has unsaved changes right now - for the Ctrl+C warning. */
  isDirty: () => boolean;
  /** Stops the session (kills dgdebug) then the HTTP server. Idempotent. */
  shutdown: () => Promise<void>;
}

function mapCompileError(error: unknown): never {
  if (error instanceof DialogCompileError) {
    const where = error.filePath ? ` (${error.filePath}${error.line ? `:${error.line}` : ''})` : '';
    throw new CliError(`compile error${where}: ${error.message}`);
  }
  throw error;
}

export async function startSkeinServer(p: StartSkeinServerParams): Promise<StartedSkeinServer> {
  return withQuietLogging(!p.verbose, async () => {
    const project = readProject(p.projectRoot); // validates dialog.json exists (throws its own message)

    let loadedTree: SkeinTree | undefined;
    if (p.mode === 'open') {
      loadedTree = await new PersistenceManager(p.projectRoot).loadSession(p.sessionId);
      if (loadedTree.getEngine() !== 'dgdebug') {
        throw new CliError('open-skein currently supports dgdebug skeins only.');
      }
    }

    if (!(await isDgdebugAvailable(project.binDir, resolveCliBundledBinDir()))) {
      throw new CliError("dgdebug not found - install the Dialog toolchain, or set dialog.json's binDir.");
    }

    let resolveQuit!: () => void;
    const waitForQuit = new Promise<void>((resolve) => {
      resolveQuit = resolve;
    });

    const service = new SkeinService({
      port: p.port,
      host: 'localhost',
      mediaRoot: resolveCliMediaRoot(),
      grammarPath: resolveCliGrammarPath(),
      standalone: true,
      onCompileError: (error) => {
        const where = error.filePath ? ` (${error.filePath}${error.line ? `:${error.line}` : ''})` : '';
        console.error(`compile error${where}: ${error.message}`);
      },
      onTraceRequested: () => {
        /* the browser opens the /trace tab itself - see main.js's openTrace */
      },
      onQuit: () => resolveQuit()
    });

    try {
      await service.start();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new CliError(`port ${p.port} is already in use.`);
      }
      throw error;
    }

    const config =
      p.mode === 'open'
        ? sessionConfigFromTree(loadedTree!, p.projectRoot, resolveCliBundledBinDir(), resolveCliPatchSourcePath())
        : {
            engine: 'dgdebug' as const,
            seed: p.seed ?? randomSeed(),
            projectRoot: p.projectRoot,
            bundledBinDir: resolveCliBundledBinDir()
          };
    const session =
      p.mode === 'open'
        ? SkeinSession.createLoaded(loadedTree!, config, service)
        : SkeinSession.createNew(config, service);

    let stopped = false;
    const shutdown = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;
      await session.stop();
      await service.stop();
    };

    try {
      try {
        await session.start();
      } catch (error) {
        mapCompileError(error);
      }

      // Replay every branch on load so live .dg edits are picked up, exactly as the extension does
      // (loadAndActivateSession). Done before setActiveSession so replayAll's tree rebuild doesn't
      // land as a "dirty" change against the save baseline - no browser is connected yet anyway.
      if (p.mode === 'open') {
        const activeKnotId = session.getTree().getActiveKnotId();
        if (activeKnotId !== null && activeKnotId !== 0) {
          try {
            await session.replayAll();
          } catch (error) {
            mapCompileError(error);
          }
        }
      }

      if (p.mode === 'new') {
        await new PersistenceManager(p.projectRoot).saveSession(session.getTree(), p.sessionId);
      }

      // setActiveSession snapshots the current tree as the clean/save baseline (service.ts's
      // lastSavedTree), so it must come after any load-time replay.
      service.setActiveSession(session, p.sessionId, () =>
        new PersistenceManager(p.projectRoot).saveSession(session.getTree(), p.sessionId)
      );
    } catch (error) {
      await shutdown();
      throw error;
    }

    const port = service.getPort();
    return {
      url: `http://localhost:${port}/?theme=${p.theme}`,
      port,
      waitForQuit,
      isDirty: () => service.isDirty(),
      shutdown
    };
  });
}

/** Best-effort "open this URL in the default browser" - no npm dependency, silently a no-op on a
 *  headless box (the URL is always printed too). */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* no browser / no windowing environment - ignore */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

/**
 * The command-facing wrapper: start the server, tell the user how to reach and stop it, open a
 * browser unless told not to, then block until the in-UI Quit completes or a SIGINT/SIGTERM
 * arrives - either way tearing the child dgdebug + HTTP server down cleanly before returning.
 */
export async function runInteractiveSkein(
  p: StartSkeinServerParams & { open?: boolean },
  banner: string
): Promise<number> {
  const started = await startSkeinServer(p);

  console.log(banner);
  console.log(`Skein UI: ${started.url}`);
  console.log('Press Ctrl+C to stop.');
  if (p.open !== false) {
    openBrowser(started.url);
  }

  const how = await new Promise<'quit' | 'signal'>((resolve) => {
    const onSignal = (): void => resolve('signal');
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    started.waitForQuit.then(() => resolve('quit')).catch(() => resolve('quit'));
  });

  if (how === 'signal') {
    console.log('');
    if (started.isDirty()) {
      console.error('Skein has unsaved changes - they were NOT saved. Use the Quit button in the browser to save on exit.');
    }
    console.log('Stopping…');
  } else {
    console.log('Skein closed.');
  }

  await started.shutdown();
  return 0;
}
