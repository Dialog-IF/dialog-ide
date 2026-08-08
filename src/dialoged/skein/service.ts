/**
 * Web service interface for the Skein engine.
 * Provides HTTP endpoints for UI communication using TypeScript Datastar library approach.
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SkeinSession } from './session';
import { SkeinTree } from './tree';
import { renderApp, renderPage, SessionDisplayInfo } from './ui/render';

/**
 * Service configuration
 */
export interface ServiceConfig {
  port: number;
  host: string;
  /** Absolute path to the vendored static assets (style.css, js/datastar.js, icons/*.svg). */
  mediaRoot: string;
}

/**
 * SSE Event type
 */
export interface SseEvent {
  type: string;
  data: any;
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const NO_ACTIVE_SESSION_FRAGMENT = '<div id="skein-app" class="p-4">No skein session running.</div>';

/**
 * Class for managing the web service interface
 */
export class SkeinService {
  private config: ServiceConfig;
  private sessions: Map<string, SkeinSession> = new Map();
  private isRunning: boolean = false;
  private server: http.Server | undefined;
  private port: number | undefined;

  private activeSession: SkeinSession | undefined;
  private activeSessionId: string | undefined;
  private readonly sseClients = new Set<http.ServerResponse>();
  private readonly onActiveSessionChange = (): void => this.broadcast();

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  /**
   * Start the web service: renders the real (read-only, for now) skein transcript over plain
   * Datastar SSE - see the Phase 1 plan for the wire-protocol research this is based on
   * (dialog-tool's own Hyper framework, traced down to genuine Datastar `datastar-patch-elements`
   * events over a long-held GET /events connection).
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Service already running');
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('Skein service request failed:', error);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.port, this.config.host, resolve);
    });

    const address = this.server.address();
    this.port = typeof address === 'object' && address !== null ? address.port : this.config.port;
    this.isRunning = true;
  }

  /**
   * Stop the web service
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Clean up all sessions
    for (const session of this.sessions.values()) {
      await session.stop();
    }
    this.sessions.clear();

    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    if (this.activeSession) {
      this.activeSession.offChange(this.onActiveSessionChange);
      this.activeSession = undefined;
      this.activeSessionId = undefined;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = undefined;
    this.port = undefined;
    this.isRunning = false;
  }

  /**
   * The actual bound port - differs from config.port when config.port is 0 (OS-assigned).
   */
  public getPort(): number {
    if (this.port === undefined) {
      throw new Error('Service is not running');
    }
    return this.port;
  }

  /**
   * Tells the web UI which session to render. Subscribes to the session's change notifications
   * (see session.ts's onChange) so the SSE loop can push a fresh render whenever the tree
   * mutates; unsubscribes from whichever session was previously active. Pass undefined for both
   * arguments when no session is running.
   */
  public setActiveSession(session: SkeinSession | undefined, sessionId: string | undefined): void {
    if (this.activeSession) {
      this.activeSession.offChange(this.onActiveSessionChange);
    }

    this.activeSession = session;
    this.activeSessionId = sessionId;

    if (this.activeSession) {
      this.activeSession.onChange(this.onActiveSessionChange);
    }

    this.broadcast();
  }

  private currentDisplayInfo(): SessionDisplayInfo | undefined {
    if (!this.activeSession || !this.activeSessionId) {
      return undefined;
    }
    const tree = this.activeSession.getTree();
    return { sessionId: this.activeSessionId, engine: tree.getEngine(), seed: tree.getSeed() };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage(this.currentDisplayInfo(), this.activeSession?.getTree()));
      return;
    }

    if (url.pathname === '/events') {
      this.handleSseConnect(res);
      return;
    }

    if (url.pathname === '/style.css') {
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'style.css'));
      return;
    }

    if (url.pathname === '/js/datastar.js') {
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'js', 'datastar.js'));
      return;
    }

    if (url.pathname.startsWith('/icons/')) {
      // path.basename strips any directory traversal from the requested name.
      const name = path.basename(url.pathname.slice('/icons/'.length));
      await this.serveStaticFile(res, path.join(this.config.mediaRoot, 'icons', name));
      return;
    }

    res.writeHead(404);
    res.end();
  }

  private handleSseConnect(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));

    // Covers the race between the initial GET / render and this connection opening.
    this.sendPatch(res);
  }

  private broadcast(): void {
    for (const client of this.sseClients) {
      this.sendPatch(client);
    }
  }

  /**
   * Writes a real Datastar `datastar-patch-elements` SSE event: each line of the fragment gets
   * its own "data: elements " prefix (SSE's data field is line-oriented - a bare multi-line
   * value would be silently mangled), matching dialog-tool's own Hyper framework's wire format.
   */
  private sendPatch(res: http.ServerResponse): void {
    if (res.writableEnded) {
      return;
    }

    const info = this.currentDisplayInfo();
    const tree = this.activeSession?.getTree();
    const html = info && tree ? renderApp(info, tree) : NO_ACTIVE_SESSION_FRAGMENT;
    const dataLines = html
      .split('\n')
      .map((line) => `data: elements ${line}`)
      .join('\n');

    res.write(`event: datastar-patch-elements\n${dataLines}\n\n`);
  }

  private async serveStaticFile(res: http.ServerResponse, filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath);
      const contentType = STATIC_CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }

  /**
   * Create a new session
   */
  public createSession(config: any): SkeinSession {
    const session = SkeinSession.createNew(config);
    this.sessions.set(session.getId(), session);
    return session;
  }

  /**
   * Load an existing session
   */
  public loadSession(tree: SkeinTree, config: any): SkeinSession {
    const session = SkeinSession.createLoaded(tree, config);
    this.sessions.set(session.getId(), session);
    return session;
  }

  /**
   * Get a session by ID
   */
  public getSession(id: string): SkeinSession | null {
    return this.sessions.get(id) || null;
  }

  /**
   * Get all active sessions
   */
  public getAllSessions(): SkeinSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Handle skein-related requests (simplified)
   */
  public async handleSkeinEndpoints(): Promise<void> {
    // This would be implemented with actual HTTP routing for:
    // - Session creation
    // - Command execution
    // - Tree data retrieval
    // - SSE event streaming

    console.log('Handling skein endpoints...');
  }

  /**
   * Serve UI components (simplified)
   */
  public serveUiComponents(): void {
    // This would serve the reactive UI components
    console.log('Serving UI components...');
  }

  /**
   * Send SSE updates to connected clients
   */
  public sendSseUpdate(event: SseEvent): void {
    // In a real implementation, this would stream events to connected clients
    console.log(`Sending SSE update: ${event.type}`, event.data);
  }

  /**
   * Check if service is running
   */
  public isRunningService(): boolean {
    return this.isRunning;
  }
}