/**
 * Logic for "Export Web Page..." - deliberately vscode-free (like dialog-export.ts/
 * dialog-project-init.ts) so it's unit-testable without mocking the extension host.
 * extension.ts resolves the dialogc/dgdebug/aambundle binaries and the vendored
 * resources/bundle/ assets directory, then calls bundleWebExport with the results.
 *
 * Mirrors dialog-tool's dgt bundle (src/dialog_tool/bundle.clj): compile every one of the
 * project's own targets plus :aa (for the in-browser player), query title/author/ifid/noun/
 * blurb/release live from dgdebug, run aambundle to produce the AAmachine web player, assemble
 * everything (vendored CSS/PDFs, story files, cover thumbnail, optional walkthrough, index.html)
 * into out/web/, then zip it into out/<name>-<release>.zip.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ZipFile } from 'yazl';
import { DialogProject, SkeinProcess, deserializeTree, expandSources } from './dialoged/skein';
import { stripAnsi } from './dialoged/skein/ui/ansi';
import { BuiltTarget, StoryInfo, renderWebExportPage } from './dialoged/skein/ui/webExportPage';
import { resizeCoverPng } from './dialog-cover-resize';
import { resolveCoverImage, resolveDialogcOptions } from './dialog-export';

export { BuiltTarget, StoryInfo };

const execFileAsync = promisify(execFile);

/** Binaries needed to build a web export - resolved by extension.ts before calling bundleWebExport. */
export interface WebExportPaths {
  dialogcPath: string;
  aambundlePath: string;
  binDir?: string;
  bundledBinDir?: string;
}

export type WebExportResult =
  | { ok: true; outDir: string; zipPath: string }
  | { ok: false; step: string; message: string };

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: string })?.stderr;
  if (stderr) {
    return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

function extFor(target: string): string {
  return target === 'aa' ? 'aastory' : target;
}

/**
 * Compiles a single target via dialogc into outputDir/<project.name>.<ext> - --strip (a release
 * build) plus, for zblorb specifically, --cover/--cover-alt if the project has a cover.png (see
 * dialog-export.ts's resolveCoverImage/buildDialogcArgs, which bakes the same cover into the
 * regular "Export Dialog Project..." zblorb export). Also appends the project's default extra
 * dialogc options (project.dialogcOptions - see resolveDialogcOptions), if any - there's no
 * per-target override here, unlike a named ExportConfig, since "Export Web Page..." has no
 * per-run configuration of its own.
 */
async function buildTarget(
  project: DialogProject,
  target: string,
  dialogcPath: string,
  outputDir: string
): Promise<BuiltTarget> {
  const outputPath = path.join(outputDir, `${project.name}.${extFor(target)}`);
  const sourceFiles = expandSources(project, { target });

  const coverArgs: string[] = [];
  if (target === 'zblorb') {
    const coverImage = resolveCoverImage(project.rootDir);
    if (coverImage) {
      coverArgs.push('--cover', coverImage, '--cover-alt', project.name);
    }
  }
  const dialogcOptions = resolveDialogcOptions(project, {});

  await execFileAsync(dialogcPath, [
    '-t',
    target,
    '-o',
    outputPath,
    '--strip',
    ...coverArgs,
    ...dialogcOptions,
    ...sourceFiles
  ]);
  const stat = await fsp.stat(outputPath);
  return {
    target,
    path: outputPath,
    name: path.basename(outputPath),
    description: `${target} ${formatSize(stat.size)}`
  };
}

/**
 * Compiles every unique target in project.target plus "aa" (needed for the in-browser player
 * regardless of whether the project itself targets aa) - matching bundle.clj's all-targets.
 */
export async function buildAllTargets(project: DialogProject, dialogcPath: string): Promise<BuiltTarget[]> {
  const outputDir = path.join(project.rootDir, 'out', 'release');
  await fsp.mkdir(outputDir, { recursive: true });

  const allTargets = Array.from(new Set([...project.target, 'aa']));
  const built: BuiltTarget[] = [];
  for (const target of allTargets) {
    built.push(await buildTarget(project, target, dialogcPath, outputDir));
  }
  return built;
}

/**
 * The subset of built targets meant for direct download - drops the "aa" build (it exists only
 * to drive the web player) unless the project explicitly targets "aa" itself.
 */
export function storyFilesFor(project: DialogProject, built: BuiltTarget[]): BuiltTarget[] {
  if (project.target.includes('aa')) {
    return built;
  }
  return built.filter((b) => b.target !== 'aa');
}

/**
 * A "(story <key>)" debug query's response is "> (story <key>)\n<value>\nQuery succeeded: ...\n" -
 * dropping the first (echoed command) and last (confirmation) lines and joining what's left
 * mirrors dialog-tool's own extract-text (bundle.clj), verified against a real dgdebug session.
 */
function extractQueryText(response: string): string {
  const lines = response.replace(/\n$/, '').split('\n');
  return lines.slice(1, -1).join(' ');
}

const STORY_TEXT_KEYS: Array<keyof Omit<StoryInfo, 'release'>> = ['title', 'author', 'ifid', 'noun', 'blurb'];
const RELEASE_RE = /\(story release (\d+)\)/;

/**
 * Queries the project's story metadata by spawning a real dgdebug process and sending
 * "(story <key>)" for each text field, plus "(story release $)" (whose value shows up inside the
 * "Query succeeded: (story release N)" confirmation line itself, not as a separate echoed line -
 * verified against a real dgdebug session, matching bundle.clj's own separate regex handling for
 * release).
 */
export async function extractStoryInfo(
  project: DialogProject,
  binDir?: string,
  bundledBinDir?: string
): Promise<StoryInfo> {
  const sourceFiles = expandSources(project);
  const skeinProcess = new SkeinProcess({ engine: 'dgdebug', seed: 0, sourceFiles, binDir, bundledBinDir });
  await skeinProcess.start();
  await skeinProcess.readResponse(); // startup banner, discarded

  const values: Partial<Record<keyof StoryInfo, string>> = {};
  for (const key of STORY_TEXT_KEYS) {
    skeinProcess.sendCommand(`(story ${key})`);
    const response = await skeinProcess.readResponse();
    values[key] = extractQueryText(response.response);
  }

  skeinProcess.sendCommand('(story release $)');
  const releaseResponse = await skeinProcess.readResponse();
  values.release = RELEASE_RE.exec(releaseResponse.response)?.[1] ?? '0';

  await skeinProcess.terminate();

  return values as StoryInfo;
}

/**
 * Extracts a walkthrough transcript from <rootDir>/default.skein (same file "Run Default Skein"
 * uses), if one exists and has a knot labeled "WALKTHROUGH" - concatenates each knot's blessed
 * response from root to that knot, skipping transcript-comment commands (a leading "*"), with
 * ANSI stripped. Returns null if there's no default.skein, or no WALKTHROUGH label in it.
 */
export function extractWalkthrough(project: DialogProject): string | null {
  const skeinPath = path.join(project.rootDir, 'default.skein');
  if (!fs.existsSync(skeinPath)) {
    return null;
  }

  const tree = deserializeTree(fs.readFileSync(skeinPath, 'utf8'));
  const knot = tree.findByLabel('WALKTHROUGH');
  if (!knot) {
    return null;
  }

  const parts: string[] = [];
  for (const { id, command } of tree.commandPath(knot.id)) {
    if (command.startsWith('*')) {
      continue;
    }
    const text = tree.getKnot(id)?.response?.text ?? '';
    parts.push(stripAnsi(text));
  }
  return parts.length > 0 ? parts.join('') : null;
}

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Zips every file under sourceDir into zipPath, with zip entries relative to sourceDir itself
 * (not including sourceDir's own name) - matching dialog-tool's `(fs/zip zip-file ["out/web"]
 * {:root "out/web"})`, so the zip extracts directly to index.html/etc. at its root.
 */
async function zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
  const zipfile = new ZipFile();
  const files = await listFilesRecursively(sourceDir);
  for (const filePath of files) {
    const entryName = path.relative(sourceDir, filePath).split(path.sep).join('/');
    zipfile.addFile(filePath, entryName);
  }

  await fsp.mkdir(path.dirname(zipPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    zipfile.outputStream.pipe(fs.createWriteStream(zipPath)).on('close', resolve).on('error', reject);
    zipfile.end();
  });
}

/**
 * Orchestrates the whole "Export Web Page..." pipeline into <rootDir>/out/web/ plus a zip at
 * <rootDir>/out/<name>-<release>.zip - see bundle.clj's bundle-project for the dialog-tool
 * original this mirrors. assetsDir is this extension's own vendored resources/bundle/ directory
 * (style.css, play.css, the two PDFs).
 */
export async function bundleWebExport(
  project: DialogProject,
  paths: WebExportPaths,
  assetsDir: string
): Promise<WebExportResult> {
  let built: BuiltTarget[];
  try {
    built = await buildAllTargets(project, paths.dialogcPath);
  } catch (error) {
    return { ok: false, step: 'build', message: messageOf(error) };
  }

  const aaBuild = built.find((b) => b.target === 'aa');
  if (!aaBuild) {
    return { ok: false, step: 'build', message: 'The "aa" target did not build (unexpected).' };
  }
  const storyFiles = storyFilesFor(project, built);

  let story: StoryInfo;
  try {
    story = await extractStoryInfo(project, paths.binDir, paths.bundledBinDir);
  } catch (error) {
    return { ok: false, step: 'story-info', message: messageOf(error) };
  }

  const outDir = path.join(project.rootDir, 'out', 'web');
  try {
    await fsp.rm(outDir, { recursive: true, force: true });
    await execFileAsync(paths.aambundlePath, ['--target', 'web', '--output', outDir, aaBuild.path]);
  } catch (error) {
    return { ok: false, step: 'aambundle', message: messageOf(error) };
  }

  try {
    await fsp.copyFile(path.join(assetsDir, 'play.css'), path.join(outDir, 'resources', 'style.css'));
    await fsp.copyFile(path.join(assetsDir, 'style.css'), path.join(outDir, 'style.css'));

    const introductionPdfPath = path.join(assetsDir, 'introduction-to-if.pdf');
    const playCardPdfPath = path.join(assetsDir, 'play-if-card.pdf');
    await fsp.copyFile(introductionPdfPath, path.join(outDir, 'introduction-to-if.pdf'));
    await fsp.copyFile(playCardPdfPath, path.join(outDir, 'play-if-card.pdf'));
    const [introductionStat, playCardStat] = await Promise.all([
      fsp.stat(introductionPdfPath),
      fsp.stat(playCardPdfPath)
    ]);

    for (const file of storyFiles) {
      await fsp.copyFile(file.path, path.join(outDir, file.name));
    }

    const coverImage = resolveCoverImage(project.rootDir);
    const hasCover = coverImage !== null;
    if (coverImage) {
      await fsp.copyFile(coverImage, path.join(outDir, 'cover.png'));
      const resized = resizeCoverPng(await fsp.readFile(coverImage));
      await fsp.writeFile(path.join(outDir, 'cover-small.png'), resized);
    }

    const walkthrough = extractWalkthrough(project);
    let walkthroughDescription: string | null = null;
    if (walkthrough !== null) {
      await fsp.writeFile(path.join(outDir, 'walkthrough.txt'), walkthrough);
      walkthroughDescription = `text ${formatSize(Buffer.byteLength(walkthrough))}`;
    }

    const html = renderWebExportPage({
      story,
      storyFiles,
      hasCover,
      introductionPdfDescription: formatSize(introductionStat.size),
      playCardPdfDescription: formatSize(playCardStat.size),
      walkthroughDescription
    });
    await fsp.writeFile(path.join(outDir, 'index.html'), html);
  } catch (error) {
    return { ok: false, step: 'assemble', message: messageOf(error) };
  }

  const zipPath = path.join(project.rootDir, 'out', `${project.name}-${story.release}.zip`);
  try {
    await zipDirectory(outDir, zipPath);
  } catch (error) {
    return { ok: false, step: 'zip', message: messageOf(error) };
  }

  return { ok: true, outDir, zipPath };
}
