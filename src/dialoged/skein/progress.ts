/**
 * Dialoged-specific abstraction over vscode.window.withProgress. session.ts (and everything it
 * pulls into service.ts) deliberately never imports 'vscode' - see buildProcessConfig's callers -
 * so it can run under plain Jest without a real VS Code host. ProgressHost is the seam: shaped to
 * match vscode.window.withProgress's real signature closely enough that a real
 * vscode.ProgressLocation/vscode.CancellationToken satisfies it structurally with no adapter code,
 * while tests inject a trivial fake instead. extension.ts (which already imports 'vscode') owns
 * the one real implementation; see its vscodeProgressHost.
 */

export interface ProgressReporter {
  report(update: { message?: string; increment?: number }): void;
}

/**
 * Deliberately a plain mutable field rather than mirroring vscode.CancellationToken's
 * onCancellationRequested event - replayTo only ever polls it once per replayed command, between
 * synchronous steps, so there's nothing for an event-based subscription to buy here, and a plain
 * boolean is trivial for tests to flip mid-replay.
 */
export interface CancellationToken {
  isCancellationRequested: boolean;
}

export interface ProgressHost {
  withProgress<T>(
    options: { title: string; cancellable: boolean },
    task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>
  ): Promise<T>;
}

/**
 * Used whenever nothing else is injected (every SkeinSession call site until extension.ts wires
 * up vscodeProgressHost, and every existing test) - runs the task immediately with a reporter
 * that discards updates and a token that never cancels, so replayTo's progress reporting and
 * cancellation checks are no-ops.
 */
export const noopProgressHost: ProgressHost = {
  async withProgress(_options, task) {
    return task({ report: () => {} }, { isCancellationRequested: false });
  }
};
