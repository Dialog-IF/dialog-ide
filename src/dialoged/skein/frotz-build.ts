/**
 * Compiles a project's sources into a .zblorb game file for the frotz/frotz-release engines,
 * mirroring dialog-tool's skein/process.clj (start-frotz-process). Unlike dgdebug, which
 * interprets .dg source directly, dfrotz needs an already-compiled game - this is the missing
 * pre-flight step session.ts's buildProcessConfig calls before launching dfrotz.
 *
 * A small status-line-suppressing patch source (resources/dfrotz-skein-patch.dg, copied verbatim
 * from dialog-tool's own resource) is compiled in ahead of the project's own sources - without it,
 * dfrotz's status bar output lands inline in the transcript and breaks io.ts's tag-line parsing.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DialogProject, expandSources, resolveCommandPath } from './project';
import { DialogCompileError } from './compile-error';

const execFileAsync = promisify(execFile);

export interface FrotzBuildConfig {
  project: DialogProject;
  engine: 'frotz' | 'frotz-release';
  binDir?: string;
  bundledBinDir?: string;
  patchSourcePath: string;
}

// Project names aren't guaranteed to be filesystem-safe (spaces, punctuation) - collapse anything
// but word characters/dashes so the temp output path is always valid across platforms.
function sanitizeForPath(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'project';
}

/**
 * Where this engine's compiled game lives - stable per project+engine so repeated builds (a fresh
 * compile runs on every session start, same as dgdebug re-parsing sources at launch) overwrite in
 * place rather than accumulating temp files.
 */
function gamePathFor(project: DialogProject, engine: 'frotz' | 'frotz-release'): string {
  return path.join(os.tmpdir(), 'dialog-ide-skein', sanitizeForPath(project.name), engine, `${project.name}.zblorb`);
}

/**
 * Compiles `config.project`'s sources (patch source first, debug sources included only for
 * `frotz` - not `frotz-release`, matching Export's own debug-sources toggle) into a .zblorb via
 * dialogc, returning the compiled game's path. Throws DialogCompileError on a non-zero dialogc
 * exit - the same error type/shape a dgdebug compile failure throws, so callers get the same
 * Problems-panel/jump-to-source UX for free.
 */
export async function buildFrotzGame(config: FrotzBuildConfig): Promise<string> {
  const { project, engine, binDir, bundledBinDir, patchSourcePath } = config;
  const dialogcPath = resolveCommandPath(binDir, 'dialogc', bundledBinDir);
  const sourceFiles = expandSources(project, {
    debug: engine === 'frotz',
    target: 'zblorb',
    prePatch: [patchSourcePath]
  });
  const gamePath = gamePathFor(project, engine);

  await fs.promises.mkdir(path.dirname(gamePath), { recursive: true });

  try {
    await execFileAsync(dialogcPath, ['-t', 'zblorb', '-o', gamePath, ...sourceFiles]);
    return gamePath;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? (error as Error).message;
    throw new DialogCompileError(stderr);
  }
}
