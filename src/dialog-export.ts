/**
 * Logic for "Configure Exports..." and "Export Dialog Project..." - deliberately vscode-free
 * (like dialog-source-coverage.ts/session-runner.ts) so it's unit-testable without mocking the
 * extension host. extension.ts owns the QuickPick/showInputBox wizard glue and calls into these
 * functions with the collected answers.
 */

import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { modify, applyEdits } from 'jsonc-parser';
import { DialogProject, ExportConfig, expandSources, parseErrorLocation } from './dialoged/skein';

const execFileAsync = promisify(execFile);

/**
 * Appends `config` to dialog.json's `exports` array, creating the array if it doesn't exist yet.
 * Edits via jsonc-parser's modify/applyEdits (like addSourceToDialogJson) so the file's existing
 * formatting and comments survive.
 */
export function addExportConfig(dialogJsonPath: string, config: ExportConfig): void {
  const text = fs.readFileSync(dialogJsonPath, 'utf8');
  const parsed = JSON.parse(text) as { exports?: ExportConfig[] };
  const existingLength = parsed.exports?.length ?? 0;

  const edits = modify(text, ['exports', existingLength], config, {
    isArrayInsertion: true,
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  fs.writeFileSync(dialogJsonPath, applyEdits(text, edits), 'utf8');
}

/** Removes the named entry from dialog.json's `exports` array. A no-op if the name isn't found. */
export function removeExportConfig(dialogJsonPath: string, name: string): void {
  const text = fs.readFileSync(dialogJsonPath, 'utf8');
  const parsed = JSON.parse(text) as { exports?: ExportConfig[] };
  const index = (parsed.exports ?? []).findIndex((entry) => entry.name === name);
  if (index === -1) {
    return;
  }

  const edits = modify(text, ['exports', index], undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  fs.writeFileSync(dialogJsonPath, applyEdits(text, edits), 'utf8');
}

/** Turns "Release zblorb" + "zblorb" into "build/release-zblorb.zblorb". */
export function defaultOutputPath(config: { name: string; format: string }): string {
  const slug =
    config.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'export';
  return `build/${slug}.${config.format}`;
}

/**
 * Builds dialogc's argv for `config`: -t/-o plus the project's expanded source files, reusing
 * expandSources' existing debug-inclusion and target-suffix filtering unchanged (a
 * "main.zblorb.dg"-style suffixed file is included/excluded exactly like it is for a dgdebug run).
 */
export function buildDialogcArgs(project: DialogProject, config: ExportConfig): string[] {
  const outputPath = path.isAbsolute(config.output) ? config.output : path.join(project.rootDir, config.output);
  const sourceFiles = expandSources(project, { debug: config.includeDebug, target: config.format });
  return ['-t', config.format, '-o', outputPath, ...sourceFiles];
}

export type ExportResult =
  | { ok: true; outputPath: string }
  | { ok: false; message: string; filePath: string | null; line: number | null };

/**
 * Runs dialogc for `config`, creating the output directory first. On a non-zero exit, parses
 * dialogc's own "Error: <path>, line <N>: <message>" output (verified directly against a real
 * dialogc compile failure - the same shape compile-error.ts already parses for dgdebug).
 */
export async function runDialogcExport(
  project: DialogProject,
  config: ExportConfig,
  dialogcPath: string
): Promise<ExportResult> {
  const args = buildDialogcArgs(project, config);
  const outputPath = args[args.indexOf('-o') + 1];
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  try {
    await execFileAsync(dialogcPath, args);
    return { ok: true, outputPath };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? (error as Error).message;
    const plain = stderr.trim();
    const location = parseErrorLocation(plain);
    return {
      ok: false,
      message: plain || 'dialogc exited with an error.',
      filePath: location?.filePath ?? null,
      line: location?.line ?? null
    };
  }
}
