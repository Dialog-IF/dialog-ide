/**
 * Scaffolding logic for "Initialize Dialog Project" - deliberately vscode-free (like
 * dialog-source-coverage.ts/session-runner.ts) so it's unit-testable without mocking the
 * extension host. extension.ts owns the prompts (project name, target formats) and calls
 * scaffoldProject with the results.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PDF_ASSETS } from './dialog-web-export';

const LIBRARY_FILES = ['stdlib.dg', 'stddebug.dg', 'unit.dg'];

export interface ScaffoldOptions {
  name: string;
  targets: string[];
}

// Mirrors dialog-tool's own new-project convention (verified against this repo's own
// __fixtures__/project/dgsample/src/meta.dg+orb.dg pair): a meta.dg carrying just the (story ...)
// metadata directives, plus a separate story file with the actual game content. A bare
// "(program entry point) print something" - what an earlier version of this scaffold used -
// compiles and runs, but only ever prints once and exits; it never enters dgdebug/the skein's
// interactive read-loop (confirmed by running it: piped-in commands after the first prompt are
// silently dropped). stdlib's real interactive loop only starts once a #player object exists
// (`(current player *)`) located `(* is #in <room>)` - the minimal room+player pair below is the
// actual "little bit more" needed for a freshly scaffolded project to behave like a normal
// interactive session under dgdebug or the skein, not just a script that runs once.
//
// Placeholder text (not the project's own dialog.json name) matches the fixture's own generated
// content ("The Intrepid Author", "A short description of the work.") - a project name is free
// text that may contain characters Dialog treats as word separators (parens, quotes,
// semicolons...), so it's deliberately not interpolated into source.
const STARTER_META_DG = `(story title)
\tUntitled Story
(story author)
\tAnonymous
(story blurb)
\tA short description of your story.
(story noun)
\tAn interactive fiction
(story release 0)
(story ifid) $IFID$
`;

// (story ifid) is required by dialogc's zblorb format specifically (confirmed against a real
// dialogc run: "Error: An IFID is mandatory for the blorb output format") - zblorb is
// dialog.json's own default target, so a freshly scaffolded project needs one to be exportable
// out of the box. $IFID$ above is substituted with a fresh crypto.randomUUID() per project.
const STARTER_STORY_DG = `#void
(room *)
(name *) The Void
(look *)
\tYou are surrounded by empty space, waiting to be filled with your story.

#player
(current player *)
(descr *)
\tAs undefined as the space you inhabit.
(* is #in #void)
`;

/**
 * Scaffolds a new Dialog project into rootDir: main/lib/debug/test directories (named to match
 * dialog.json's own category names 1:1, rather than a coding convention like "src", so a
 * non-coder can map "where do my sources go" without indirection), a starter main/meta.dg +
 * main/story.dg pair, dialog.json itself, and copies of the three standard library files into
 * lib/.
 *
 * The standard library files live together in lib/ (one folder to recognize as "don't touch
 * this"), but dialog.json wires each into just the category that actually needs it - stddebug.dg
 * only compiles into debug builds, unit.dg only into test builds, stdlib.dg into everything -
 * by listing the individual file path alongside each category's own directory (expandSources
 * already supports a source entry being either a directory or a specific file).
 *
 * Also seeds a placeholder cover.png at the project root (from coverImageSource, if given and it
 * exists) - matching dialog-tool's own `dgt new` convention. "Export Dialog Project..." bakes
 * this into a zblorb export via dialogc's --cover flag (see dialog-export.ts's
 * resolveCoverImage), and "Export Web Page..." uses it as the page's cover thumbnail. Silently
 * skipped (no cover.png written) if coverImageSource is undefined or missing, rather than
 * failing the whole scaffold over a cosmetic asset.
 *
 * Similarly seeds the two "how to play IF" PDFs (PDF_ASSETS) at the project root, from
 * pdfAssetsDir, if given - "Export Web Page..." links to whichever of these still exist at
 * export time (see dialog-web-export.ts's resolvePdfLinks), so deleting one from the project
 * root is how an author opts it out of the exported page. Each PDF is skipped independently if
 * missing from pdfAssetsDir, same tolerant handling as the cover image.
 *
 * Throws if dialog.json already exists at rootDir (no silent overwrite of an existing project),
 * or if libraryDir is undefined (local dev before `npm run fetch-dialog-binaries` has ever been
 * run - every packaged/published build always has it bundled).
 */
export function scaffoldProject(
  rootDir: string,
  options: ScaffoldOptions,
  libraryDir: string | undefined,
  coverImageSource?: string,
  pdfAssetsDir?: string
): void {
  const dialogJsonPath = path.join(rootDir, 'dialog.json');
  if (fs.existsSync(dialogJsonPath)) {
    throw new Error(`${dialogJsonPath} already exists - this folder already has a Dialog project.`);
  }
  if (!libraryDir) {
    throw new Error(
      'No bundled standard library found. Run "npm run fetch-dialog-binaries" first, or install the Dialog toolchain and copy stdlib.dg/stddebug.dg/unit.dg into lib/ yourself.'
    );
  }

  for (const dir of ['main', 'lib', 'debug', 'test']) {
    fs.mkdirSync(path.join(rootDir, dir), { recursive: true });
  }

  const metaDg = STARTER_META_DG.replace('$IFID$', crypto.randomUUID().toUpperCase());
  fs.writeFileSync(path.join(rootDir, 'main', 'meta.dg'), metaDg);
  fs.writeFileSync(path.join(rootDir, 'main', 'story.dg'), STARTER_STORY_DG);

  for (const file of LIBRARY_FILES) {
    fs.copyFileSync(path.join(libraryDir, file), path.join(rootDir, 'lib', file));
  }

  if (coverImageSource && fs.existsSync(coverImageSource)) {
    fs.copyFileSync(coverImageSource, path.join(rootDir, 'cover.png'));
  }

  if (pdfAssetsDir) {
    for (const asset of PDF_ASSETS) {
      const source = path.join(pdfAssetsDir, asset.filename);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(rootDir, asset.filename));
      }
    }
  }

  const dialogJson = {
    name: options.name,
    target: options.targets,
    sources: {
      main: ['main'],
      test: ['test', 'lib/unit.dg'],
      debug: ['debug', 'lib/stddebug.dg'],
      library: ['lib/stdlib.dg']
    }
  };
  fs.writeFileSync(dialogJsonPath, `${JSON.stringify(dialogJson, null, 2)}\n`);
}
