/**
 * Project discovery and configuration for the Skein engine.
 *
 * Reads this IDE's own dialog.json project descriptor and expands its declared sources into
 * the ordered file list dgdebug/dialogc expect. Behaviorally mirrors dialog-tool's
 * project_file.clj (directory-or-file source entries, main/test/debug/library ordering,
 * target-suffix filename filtering, bin-dir command resolution) - dialog-tool itself reads a
 * dialog.edn (Clojure EDN) file; this IDE deliberately uses JSON instead so it can be parsed
 * without an EDN dependency, but the source-expansion semantics are kept identical so the same
 * project layout conventions (and the same dgdebug/dialogc command lines) apply.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ProjectSources {
  main: string[];
  test?: string[];
  debug?: string[];
  library?: string[];
}

export interface ExportConfig {
  name: string;
  format: 'zblorb' | 'z8' | 'aa';
  includeDebug: boolean;
  output: string;
  // Extra dialogc command-line arguments (e.g. ["--heap", "2000"]) specific to this export -
  // when omitted, falls back to the project's own dialogcOptions (see DialogProject), if any.
  // See dialog-export.ts's resolveDialogcOptions for the fallback logic.
  dialogcOptions?: string[];
}

/**
 * A "feelie" - an auxiliary file (traditionally a PDF, but not required to be) linked from
 * "Export Web Page..."'s generated page, e.g. a "how to play IF" primer. `path` is relative to
 * the project root (like a source entry); `name` is the link text. See dialog-web-export.ts's
 * resolveFeelieLinks - unlike the old hardcoded PDF_ASSETS convention, a configured feelie whose
 * file is missing at export time is an error, not a silent omission.
 */
export interface FeelieConfig {
  path: string;
  name: string;
}

export interface DialogProject {
  name: string;
  binDir?: string;
  sources: ProjectSources;
  exports: ExportConfig[];
  // Extra dialogc command-line arguments applied to every dialogc invocation that doesn't
  // specify its own (an ExportConfig's own dialogcOptions, if set, replaces this rather than
  // appending to it - see dialog-export.ts's resolveDialogcOptions) - also applied to the "aa"
  // build "Export Web Page..." makes for the in-browser player.
  dialogcOptions?: string[];
  feelies?: FeelieConfig[];
  rootDir: string;
}

/**
 * Resolves dialog.json's binDir the same way expandSourceEntry resolves a source entry: relative
 * to rootDir, absolute paths passed through unchanged. Without this, a relative binDir (the
 * common case - e.g. "bin") would join against the extension host process's cwd instead of the
 * project folder, silently missing the binaries and surfacing as the generic "not found on PATH"
 * message.
 */
function resolveBinDir(rootDir: string, binDir: string | undefined): string | undefined {
  if (!binDir) {
    return undefined;
  }
  return path.isAbsolute(binDir) ? binDir : path.join(rootDir, binDir);
}

/**
 * Reads and parses <rootDir>/dialog.json. Throws if the file is missing or isn't valid JSON -
 * there's no sensible fallback for a project the caller explicitly asked to open.
 */
export function readProject(rootDir: string): DialogProject {
  const filePath = path.join(rootDir, 'dialog.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filePath} does not exist`);
  }

  let parsed: {
    name?: string;
    binDir?: string;
    sources?: Partial<ProjectSources>;
    exports?: unknown;
    dialogcOptions?: unknown;
    feelies?: unknown;
  };
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${(error as Error).message}`);
  }

  return {
    name: parsed.name ?? '',
    binDir: resolveBinDir(rootDir, parsed.binDir),
    sources: { main: [], ...parsed.sources },
    exports: normalizeExports(parsed.exports),
    dialogcOptions: normalizeDialogcOptions(parsed.dialogcOptions),
    feelies: normalizeFeelies(parsed.feelies),
    rootDir
  };
}

/** Parses a dialogcOptions value (project-level or per-export) defensively: a non-string-array
 * value, or one with non-string entries, is treated as absent rather than failing the read. */
function normalizeDialogcOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return undefined;
  }
  return value as string[];
}

/**
 * Parses dialog.json's `exports` array defensively - an entry missing name/format/output is
 * skipped with a warning rather than failing the whole project read, matching how a missing
 * source-entry path is handled by expandSourceEntry.
 */
function normalizeExports(exports: unknown): ExportConfig[] {
  if (!Array.isArray(exports)) {
    return [];
  }
  const result: ExportConfig[] = [];
  for (const entry of exports) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as ExportConfig).name === 'string' &&
      typeof (entry as ExportConfig).format === 'string' &&
      typeof (entry as ExportConfig).output === 'string'
    ) {
      const { name, format, output } = entry as ExportConfig;
      const dialogcOptions = normalizeDialogcOptions((entry as ExportConfig).dialogcOptions);
      result.push({
        name,
        format,
        output,
        includeDebug: Boolean((entry as ExportConfig).includeDebug),
        ...(dialogcOptions ? { dialogcOptions } : {})
      });
    } else {
      console.warn(`Skipping malformed dialog.json export entry: ${JSON.stringify(entry)}`);
    }
  }
  return result;
}

/**
 * Parses dialog.json's `feelies` array defensively - an entry missing path/name is skipped with
 * a warning rather than failing the whole project read, matching normalizeExports.
 */
function normalizeFeelies(feelies: unknown): FeelieConfig[] {
  if (!Array.isArray(feelies)) {
    return [];
  }
  const result: FeelieConfig[] = [];
  for (const entry of feelies) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as FeelieConfig).path === 'string' &&
      typeof (entry as FeelieConfig).name === 'string'
    ) {
      const { path: feeliePath, name } = entry as FeelieConfig;
      result.push({ path: feeliePath, name });
    } else {
      console.warn(`Skipping malformed dialog.json feelie entry: ${JSON.stringify(entry)}`);
    }
  }
  return result;
}

export interface ExpandSourcesOptions {
  debug?: boolean;
  test?: boolean;
  target?: string;
  prePatch?: string[];
}

/**
 * Matches a target suffix embedded in a source file's name, e.g. "effects.zblorb.dg" has
 * target "zblorb". Most files have no such suffix and are always included regardless of the
 * requested target.
 */
const TARGET_SUFFIX_RE = /\.([^.]+)\.dg$/i;

/**
 * Expands a project's declared sources into an ordered, flat list of absolute file paths -
 * the order is pre-patch, main, test (if requested), debug (if requested), library, matching
 * dialog-tool's expand-sources. Each source entry is either a directory (expanded to its
 * *.dg files, sorted, non-recursive) or a specific file (included as-is). A source-suffix
 * filter (e.g. only "zblorb"-targeted files) is applied last if a target is given.
 */
export function expandSources(project: DialogProject, options: ExpandSourcesOptions = {}): string[] {
  const { debug = false, test = false, target, prePatch = [] } = options;
  const { main, test: testSources = [], debug: debugSources = [], library = [] } = project.sources;

  const entries = [
    ...prePatch,
    ...main,
    ...(test ? testSources : []),
    ...(debug ? debugSources : []),
    ...library
  ];

  const expanded = entries.flatMap((entry) => expandSourceEntry(project.rootDir, entry));
  return filterByTarget(expanded, target);
}

/**
 * True when `filePath` is covered by one of the project's declared source entries in *any*
 * category (main/test/debug/library), regardless of the debug/test gating `expandSources`
 * applies for compilation - a file under a declared `test`-only directory is still "part of the
 * project" for this check even though a default `expandSources({})` call wouldn't include it.
 * A directory entry covers only its direct children (matching `expandSourceEntry`'s
 * non-recursive expansion); a file entry covers only itself.
 */
export function isFileCoveredBySource(project: DialogProject, filePath: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const { main, test = [], debug = [], library = [] } = project.sources;
  const entries = [...main, ...test, ...debug, ...library];

  return entries.some((entry) => {
    const fullPath = path.isAbsolute(entry) ? entry : path.join(project.rootDir, entry);
    if (!fs.existsSync(fullPath)) {
      return false;
    }
    if (fs.statSync(fullPath).isDirectory()) {
      return path.dirname(resolvedFile) === path.resolve(fullPath);
    }
    return path.resolve(fullPath) === resolvedFile;
  });
}

/**
 * One source file declared by more than one dialog.json source entry - see
 * findDuplicateSourceFiles. `categories` lists each category that covers it, once per covering
 * entry (so a file listed twice within the very same category, e.g. two overlapping directory
 * entries, shows that category name twice rather than being deduplicated away).
 */
export interface DuplicateSourceFile {
  filePath: string;
  categories: string[];
}

/**
 * Every source file covered by more than one of dialog.json's declared source entries - whether
 * across categories (the same file listed under both `main` and `debug`, say) or within a single
 * one (two directory entries that happen to overlap). Unlike isFileCoveredBySource, this doesn't
 * check one candidate file against the project - it scans the whole project for any file that's
 * declared more than once anywhere.
 *
 * This matters because, unlike a plain "unused/uncovered" file, a duplicate can't just be
 * ignored: Dialog compiles/loads sources in the single fixed order expandSources produces, so a
 * duplicated file would be fed to dgdebug/dialogc twice, at two different points in that order -
 * clumsy hand-editing of dialog.json (e.g. copy-pasting an entry into the wrong category, or two
 * directory entries that overlap) is the expected cause, not something to silently tolerate.
 *
 * Only considers a file duplicated when it resolves to the *same* actual path from two different
 * entries (a directory entry and an explicit file entry both covering the same .dg file counts,
 * same as isFileCoveredBySource) - two different files that merely share a name in different
 * directories do not. Results are sorted by file path for deterministic reporting.
 */
export function findDuplicateSourceFiles(project: DialogProject): DuplicateSourceFile[] {
  const { main, test = [], debug = [], library = [] } = project.sources;
  const categoryEntries: [string, string[]][] = [
    ['main', main],
    ['test', test],
    ['debug', debug],
    ['library', library]
  ];

  const categoriesByFile = new Map<string, string[]>();
  for (const [category, entries] of categoryEntries) {
    for (const entry of entries) {
      for (const filePath of expandSourceEntry(project.rootDir, entry)) {
        const resolved = path.resolve(filePath);
        const categories = categoriesByFile.get(resolved);
        if (categories) {
          categories.push(category);
        } else {
          categoriesByFile.set(resolved, [category]);
        }
      }
    }
  }

  const duplicates: DuplicateSourceFile[] = [];
  for (const [filePath, categories] of categoriesByFile) {
    if (categories.length > 1) {
      duplicates.push({ filePath, categories });
    }
  }
  return duplicates.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function expandSourceEntry(rootDir: string, entry: string): string[] {
  const fullPath = path.isAbsolute(entry) ? entry : path.join(rootDir, entry);

  if (!fs.existsSync(fullPath)) {
    console.warn(`No match for ${entry}`);
    return [];
  }

  if (fs.statSync(fullPath).isDirectory()) {
    return fs
      .readdirSync(fullPath)
      .filter((name) => name.endsWith('.dg'))
      .sort()
      .map((name) => path.join(fullPath, name));
  }

  return [fullPath];
}

function filterByTarget(paths: string[], target: string | undefined): string[] {
  if (!target) {
    return paths;
  }
  return paths.filter((filePath) => {
    const match = TARGET_SUFFIX_RE.exec(path.basename(filePath));
    return !match || match[1] === target;
  });
}

/**
 * Resolves the command to launch a Dialog toolchain binary (dgdebug, dialogc, aambundle) - from
 * the project's binDir if given, then bundledBinDir (this extension's own bundled copy, if one
 * was packaged for the current platform/arch - see resolveBundledBinDir), otherwise the bare
 * command name, relying on PATH. Callers for a binary this extension doesn't bundle (dfrotz -
 * see process.ts's buildCommand) must omit bundledBinDir, since that directory never contains it
 * and passing it anyway would resolve to a path that's always ENOENT instead of falling through
 * to PATH.
 */
export function resolveCommandPath(
  binDir: string | undefined,
  command: string,
  bundledBinDir?: string
): string {
  const named = process.platform === 'win32' ? `${command}.exe` : command;
  const dir = binDir ?? bundledBinDir;
  return dir ? path.join(dir, named) : named;
}

/**
 * The platform-specific bundled-binary directory inside this installed extension package
 * (bin/<process.platform>-<process.arch>/), if this build was packaged for the current
 * platform/arch (see scripts/fetch-dialog-binaries.js and package.json's per-target vsce
 * packages) - undefined for the universal package or an unsupported platform/arch, in which
 * case callers fall back to PATH.
 */
export function resolveBundledBinDir(extensionPath: string): string | undefined {
  const dir = path.join(extensionPath, 'bin', `${process.platform}-${process.arch}`);
  const named = process.platform === 'win32' ? 'dgdebug.exe' : 'dgdebug';
  return fs.existsSync(path.join(dir, named)) ? dir : undefined;
}

/**
 * The bundled standard-library directory (bin/dialog-lib/) inside this installed extension
 * package - platform-independent (plain Dialog source, not a binary), staged by
 * scripts/fetch-dialog-binaries.js for every packaged variant. Undefined only in local dev
 * before that script has ever been run (bin/ is gitignored).
 */
export function resolveBundledLibraryDir(extensionPath: string): string | undefined {
  const dir = path.join(extensionPath, 'bin', 'dialog-lib');
  return fs.existsSync(path.join(dir, 'stdlib.dg')) ? dir : undefined;
}
