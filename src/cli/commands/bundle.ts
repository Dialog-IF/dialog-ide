/**
 * `dgbuild bundle [export-name]` - builds a self-contained web page (out/web/, plus a zip at
 * out/<name>-<release>.zip) for one of dialog.json's named export configurations: a downloadable
 * story file, an AAmachine in-browser player, the project's configured feelies, cover art and
 * (if present) a walkthrough. Headless equivalent of the extension's "Export Web Page..."
 * command - both call the same vscode-free bundleWebExport pipeline (src/dialog-web-export.ts).
 * Meant to let a GitHub Action publish a new release of a project without the extension host.
 */

import { Command } from 'commander';
import { ExportConfig, readProject, resolveCommandPath } from '../../dialoged/skein';
import { isAambundleAvailable, isDgdebugAvailable, isDialogcAvailable } from '../../session-runner';
import { WebExportPaths, bundleWebExport } from '../../dialog-web-export';
import {
  CliError,
  resolveCliBundleAssetsDir,
  resolveCliBundledBinDir,
  resolveCliProjectRoot,
  withQuietLogging
} from '../context';

export interface BundleOptions {
  project?: string;
  verbose?: boolean;
  cwd?: string;
}

/**
 * Picks which dialog.json export configuration drives the downloadable story file, mirroring the
 * extension's QuickPick (extension.ts's exportWebPage) but resolved from a CLI argument: an
 * explicit name must match exactly; an omitted name auto-selects the sole configuration when
 * there's exactly one, and is otherwise ambiguous. Pure - no I/O, directly unit-testable.
 */
export function resolveExportConfig(exports: ExportConfig[], name: string | undefined): ExportConfig {
  if (exports.length === 0) {
    throw new CliError(
      'No export configurations defined in dialog.json - add one under "exports" (or use "Configure Exports..." in the IDE) before bundling.'
    );
  }

  if (name === undefined) {
    if (exports.length === 1) {
      return exports[0];
    }
    throw new CliError(
      `Multiple export configurations defined - name the one to bundle: ${exports.map((c) => c.name).join(', ')}.`
    );
  }

  const match = exports.find((config) => config.name === name);
  if (!match) {
    throw new CliError(
      `No export configuration named "${name}" in dialog.json. Defined: ${exports.map((c) => c.name).join(', ')}.`
    );
  }
  return match;
}

export async function bundleCommand(name: string | undefined, options: BundleOptions): Promise<number> {
  const projectRoot = resolveCliProjectRoot(options.cwd ?? process.cwd(), options.project);
  const project = readProject(projectRoot); // validates dialog.json exists, same as every other command
  const config = resolveExportConfig(project.exports, name);

  const bundledBinDir = resolveCliBundledBinDir();
  const [dialogcOk, dgdebugOk, aambundleOk] = await Promise.all([
    isDialogcAvailable(project.binDir, bundledBinDir),
    isDgdebugAvailable(project.binDir, bundledBinDir),
    isAambundleAvailable(project.binDir, bundledBinDir)
  ]);
  const missing = [
    !dialogcOk && 'dialogc',
    !dgdebugOk && 'dgdebug',
    !aambundleOk && 'aambundle'
  ].filter((n): n is string => Boolean(n));
  if (missing.length > 0) {
    throw new CliError(
      `${missing.join(', ')} not found - install the Dialog toolchain (and AAmachine, for aambundle), or set dialog.json's binDir.`
    );
  }

  const paths: WebExportPaths = {
    dialogcPath: resolveCommandPath(project.binDir, 'dialogc', bundledBinDir),
    aambundlePath: resolveCommandPath(project.binDir, 'aambundle', bundledBinDir),
    binDir: project.binDir,
    bundledBinDir
  };

  const result = await withQuietLogging(!options.verbose, () =>
    bundleWebExport(project, config, paths, resolveCliBundleAssetsDir())
  );

  if (result.ok !== true) {
    throw new CliError(`Bundle failed (${result.step}): ${result.message}`);
  }

  console.log(`Bundled "${project.name}" (export "${config.name}"):`);
  console.log(`  web page: ${result.outDir}`);
  console.log(`  zip:      ${result.zipPath}`);
  return 0;
}

export function registerBundleCommand(program: Command): void {
  program
    .command('bundle')
    .description('Build a web page (out/web/ + zip) for a dialog.json export configuration')
    .argument('[export-name]', 'export configuration name (default: the only one, if exactly one is defined)')
    .option('-p, --project <dir>', 'project directory (default: current directory)')
    .option('-v, --verbose', 'print the underlying dgdebug process commands/lifecycle logging')
    .action(async (exportName: string | undefined, options: BundleOptions) => {
      process.exitCode = await bundleCommand(exportName, options);
    });
}
