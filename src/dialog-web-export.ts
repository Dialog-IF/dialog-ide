/**
 * Logic for "Export Web Page..." - deliberately vscode-free (like dialog-export.ts/
 * dialog-project-init.ts) so it's unit-testable without mocking the extension host.
 * extension.ts resolves the dialogc/dgdebug/aambundle binaries, asks which of dialog.json's
 * named export configurations should build the downloadable story file (see buildStoryFile),
 * and the vendored resources/bundle/ assets directory, then calls bundleWebExport with the
 * results.
 *
 * Loosely mirrors dialog-tool's dgt bundle (src/dialog_tool/bundle.clj), adapted for dialog-ide's
 * own named-export-configuration model rather than dialog.edn's single :target list: compile the
 * chosen export configuration's format as the downloadable story file, plus :aa separately (for
 * the in-browser player, unless the chosen configuration is itself :aa - see bundleWebExport),
 * query title/author/ifid/noun/blurb/release live from dgdebug, run aambundle to produce the
 * AAmachine web player, assemble everything (vendored CSS, the story file, cover thumbnail, the
 * project's configured feelies - see resolveFeelieLinks, optional walkthrough, index.html) into
 * out/web/, then zip it into out/<name>-<release>.zip.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ZipFile } from 'yazl';
import { DialogProject, ExportConfig, FeelieConfig, SkeinProcess, deserializeTree, expandSources } from './dialoged/skein';
import { stripAnsi } from './dialoged/skein/ui/ansi';
import { BuiltTarget, FeelieLink, StoryInfo, renderWebExportPage } from './dialoged/skein/ui/webExportPage';
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
 * The two "how to play IF" PDFs "Initialize Dialog Project" seeds at the project root and wires
 * into the freshly generated dialog.json's `feelies` array (see dialog-project-init.ts's
 * scaffoldProject) - not otherwise special once a project exists; from then on feelies are plain
 * dialog.json config (see FeelieConfig/resolveFeelieLinks), and a user is free to remove either
 * via "Remove Feelie...".
 */
export const DEFAULT_FEELIES: FeelieConfig[] = [
  { path: 'introduction-to-if.pdf', name: 'Introduction to IF' },
  { path: 'play-if-card.pdf', name: 'IF in One Page' }
];

/**
 * Copies each of project.feelies' files into outDir, returning a FeelieLink per one (in
 * dialog.json order). Unlike the old hardcoded-PDF opt-out-by-deletion convention, a configured
 * feelie whose file is missing is an error - the user explicitly asked for it to be there, so
 * silently omitting it would hide a mistake (a typo'd path, a moved/deleted file) rather than
 * surface it.
 */
async function resolveFeelieLinks(project: DialogProject, outDir: string): Promise<FeelieLink[]> {
  const links: FeelieLink[] = [];
  for (const feelie of project.feelies ?? []) {
    const sourcePath = path.join(project.rootDir, feelie.path);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Feelie "${feelie.name}" not found: ${sourcePath}`);
    }
    const fileName = path.basename(feelie.path);
    await fsp.copyFile(sourcePath, path.join(outDir, fileName));
    const stat = await fsp.stat(sourcePath);
    const ext = path.extname(feelie.path).replace(/^\./, '') || 'file';
    links.push({
      name: fileName,
      label: feelie.name,
      description: formatSize(stat.size),
      ext
    });
  }
  return links;
}

/**
 * Compiles `format` via dialogc into outputDir/<project.name>.<ext> - --strip (a release build)
 * plus, for zblorb specifically, --cover/--cover-alt if the project has a cover.png (see
 * dialog-export.ts's resolveCoverImage/buildDialogcArgs, which bakes the same cover into the
 * regular "Export Dialog Project..." zblorb export).
 */
async function compile(
  project: DialogProject,
  spec: { format: string; includeDebug: boolean; dialogcOptions: string[] },
  dialogcPath: string,
  outputDir: string
): Promise<BuiltTarget> {
  const outputPath = path.join(outputDir, `${project.name}.${extFor(spec.format)}`);
  const sourceFiles = expandSources(project, { target: spec.format, debug: spec.includeDebug });

  const coverArgs: string[] = [];
  if (spec.format === 'zblorb') {
    const coverImage = resolveCoverImage(project.rootDir);
    if (coverImage) {
      coverArgs.push('--cover', coverImage, '--cover-alt', project.name);
    }
  }

  await execFileAsync(dialogcPath, [
    '-t',
    spec.format,
    '-o',
    outputPath,
    '--strip',
    ...coverArgs,
    ...spec.dialogcOptions,
    ...sourceFiles
  ]);
  const stat = await fsp.stat(outputPath);
  return {
    target: spec.format,
    path: outputPath,
    name: path.basename(outputPath),
    description: `${spec.format} ${formatSize(stat.size)}`
  };
}

/**
 * Builds the downloadable story file for "Export Web Page..." from a dialog.json export
 * configuration the user picked (see extension.ts's exportWebPage) - reusing that
 * configuration's own format/includeDebug/dialogcOptions (falling back to the project's default
 * dialogcOptions, same as a regular "Export Dialog Project..." run - see resolveDialogcOptions),
 * rather than "Export Web Page..." having its own separate notion of which format(s) to build.
 */
export async function buildStoryFile(
  project: DialogProject,
  config: ExportConfig,
  dialogcPath: string
): Promise<BuiltTarget> {
  const outputDir = path.join(project.rootDir, 'out', 'release');
  await fsp.mkdir(outputDir, { recursive: true });
  return compile(
    project,
    { format: config.format, includeDebug: config.includeDebug, dialogcOptions: resolveDialogcOptions(project, config) },
    dialogcPath,
    outputDir
  );
}

/**
 * Builds a plain "aa" release (no debug sources, just the project's default dialogcOptions) to
 * drive the in-browser player - separate from buildStoryFile's own build, since the chosen story
 * export configuration might not itself target "aa" (bundleWebExport reuses buildStoryFile's own
 * output instead of calling this when it does, to avoid building "aa" twice).
 */
export async function buildAaPlayer(project: DialogProject, dialogcPath: string): Promise<BuiltTarget> {
  const outputDir = path.join(project.rootDir, 'out', 'release');
  await fsp.mkdir(outputDir, { recursive: true });
  return compile(
    project,
    { format: 'aa', includeDebug: false, dialogcOptions: resolveDialogcOptions(project, {}) },
    dialogcPath,
    outputDir
  );
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
 * original this loosely mirrors. storyConfig is the dialog.json export configuration the user
 * picked (extension.ts's exportWebPage) to build as the downloadable story file - if its own
 * format is "aa", that same build also drives the in-browser player (no separate build); for any
 * other format, "aa" is built separately (see buildAaPlayer) purely to drive the player, and
 * isn't itself offered as a download. assetsDir is this extension's own vendored
 * resources/bundle/ directory (style.css, play.css) - feelies, by contrast, come from the
 * project's own dialog.json `feelies` config (see resolveFeelieLinks).
 */
export async function bundleWebExport(
  project: DialogProject,
  storyConfig: ExportConfig,
  paths: WebExportPaths,
  assetsDir: string
): Promise<WebExportResult> {
  let storyBuild: BuiltTarget;
  try {
    storyBuild = await buildStoryFile(project, storyConfig, paths.dialogcPath);
  } catch (error) {
    return { ok: false, step: 'build', message: messageOf(error) };
  }

  let aaBuild: BuiltTarget;
  if (storyConfig.format === 'aa') {
    aaBuild = storyBuild;
  } else {
    try {
      aaBuild = await buildAaPlayer(project, paths.dialogcPath);
    } catch (error) {
      return { ok: false, step: 'build', message: messageOf(error) };
    }
  }
  const storyFiles = [storyBuild];

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

    const feelieLinks = await resolveFeelieLinks(project, outDir);

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
      feelieLinks,
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
