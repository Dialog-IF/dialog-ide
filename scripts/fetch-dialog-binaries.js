#!/usr/bin/env node
/**
 * Downloads the pinned Dialog-IF/dialog and Dialog-IF/aamachine releases and stages their
 * prebuilt dgdebug/dialogc/aambundle binaries into bin/<vsce-target>/ for packaging, plus
 * dialog's stdlib.dg/stddebug.dg/unit.dg standard library sources into bin/dialog-lib/
 * (platform-independent, staged for every target including "none" - see stageLibrary). Run
 * manually before a targeted `vsce package`/`vsce publish` pass - see the
 * release-to-marketplace skill. Never run as part of `npm test`/`npm run build` or CI.
 *
 * Only `aambundle` is staged from the aamachine release, not `aamrun`/`aamshow` - those are
 * large (tens of MB) local-playback tools unrelated to "Export Web Page..."'s use of aambundle
 * to produce the AAmachine web player bundle.
 *
 * Usage: node scripts/fetch-dialog-binaries.js --target <win32-x64|darwin-arm64|linux-x64|all|none>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VERSION_FILE = path.join(__dirname, 'dialog-toolchain-version.json');
const CACHE_DIR = path.join(ROOT, '.cache', 'dialog-release');
const BIN_DIR = path.join(ROOT, 'bin');

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--target');
  if (idx === -1 || !args[idx + 1]) {
    throw new Error(
      'Usage: node scripts/fetch-dialog-binaries.js --target <win32-x64|darwin-arm64|linux-x64|all|none>'
    );
  }
  return args[idx + 1];
}

function loadVersions() {
  return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, { headers: { 'User-Agent': 'dialog-ide-fetch-script' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          download(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode} ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', reject);
  });
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Returns the cached-and-verified `prebuilt/` dir for a pinned release, downloading and
 * extracting it first if this is the first invocation for this tag. `repo` is the GitHub
 * "owner/name" to download from; `zipPrefix` is the artifact's filename prefix (e.g. "dialog" ->
 * "dialog-1c02-1.2.3.zip", "aamachine" -> "aamachine-1.0.1.zip" - both releases follow the same
 * "<prefix>-<tag-without-'release-'-prefix>.zip" naming convention).
 */
async function ensureExtracted(repo, zipPrefix, release) {
  const zipName = `${zipPrefix}-${release.tag.replace(/^release-/, '')}.zip`;
  const releaseCacheDir = path.join(CACHE_DIR, repo, release.tag);
  const extractedDir = path.join(releaseCacheDir, zipName.replace(/\.zip$/, ''));
  const prebuiltDir = path.join(extractedDir, 'prebuilt');

  if (fs.existsSync(prebuiltDir)) {
    return prebuiltDir;
  }

  fs.mkdirSync(releaseCacheDir, { recursive: true });
  const zipPath = path.join(releaseCacheDir, zipName);

  if (!fs.existsSync(zipPath)) {
    const url = `https://github.com/${repo}/releases/download/${release.tag}/${zipName}`;
    console.log(`Downloading ${url}`);
    await download(url, zipPath);
  }

  const expectedSha = release.sha256[zipName];
  if (!expectedSha) {
    throw new Error(`No pinned sha256 for ${zipName} in ${VERSION_FILE}`);
  }
  const actualSha = sha256(zipPath);
  if (actualSha !== expectedSha) {
    fs.unlinkSync(zipPath);
    throw new Error(
      `sha256 mismatch for ${zipName}: expected ${expectedSha}, got ${actualSha} - deleted the ` +
        'downloaded file, re-run to retry'
    );
  }

  console.log(`Extracting ${zipName}`);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', releaseCacheDir]);

  if (!fs.existsSync(prebuiltDir)) {
    throw new Error(`Expected ${prebuiltDir} after extraction - upstream archive layout may have changed`);
  }
  return prebuiltDir;
}

/**
 * Copies `commands` (each a bare command name, no exe suffix) from prebuiltDir/targetConfig's
 * upstream subdirectory into bin/<targetName>/, alongside whatever's already staged there -
 * called once for dialog's {dgdebug,dialogc} and again for aamachine's {aambundle}, both landing
 * in the same per-target directory so resolveBundledBinDir/resolveCommandPath (project.ts) see
 * one merged toolchain directory.
 */
function stageCommands(prebuiltDir, targetName, targetConfig, commands) {
  const src = path.join(prebuiltDir, targetConfig.upstreamDir);
  const dest = path.join(BIN_DIR, targetName);
  fs.mkdirSync(dest, { recursive: true });

  for (const command of commands) {
    const name = `${command}${targetConfig.exeSuffix}`;
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Expected ${srcPath} - upstream archive layout may have changed`);
    }
    fs.copyFileSync(srcPath, destPath);
    if (targetConfig.exeSuffix === '') {
      // Defends against a zip that didn't preserve the executable bit.
      fs.chmodSync(destPath, 0o755);
    }
  }
  console.log(`Staged bin/${targetName}/{${commands.join(',')}}${targetConfig.exeSuffix}`);
}

const LIBRARY_FILES = ['stdlib.dg', 'stddebug.dg', 'unit.dg'];

/**
 * Stages the platform-independent standard library sources into bin/dialog-lib/, from the
 * release root (a sibling of prebuiltDir, not inside it - the same place Homebrew's own
 * dialog-if formula installs them from: `pkgshare.install "stdlib.dg", "stddebug.dg", "unit.dg"`).
 * Called for every target, including "none", since "Initialize Dialog Project" needs these
 * bundled regardless of which (if any) platform binaries a build ships.
 */
function stageLibrary(extractedDir) {
  const dest = path.join(BIN_DIR, 'dialog-lib');
  fs.mkdirSync(dest, { recursive: true });

  for (const name of LIBRARY_FILES) {
    const srcPath = path.join(extractedDir, name);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Expected ${srcPath} - upstream archive layout may have changed`);
    }
    fs.copyFileSync(srcPath, path.join(dest, name));
  }
  console.log(`Staged bin/dialog-lib/{${LIBRARY_FILES.join(',')}}`);
}

async function stageTarget(targetName, dialogPrebuiltDir, dialogTargets, aamachinePrebuiltDir, aamachineTargets) {
  const dialogConfig = dialogTargets[targetName];
  if (!dialogConfig) {
    throw new Error(`Unknown target "${targetName}" - expected one of: ${Object.keys(dialogTargets).join(', ')}, all, none`);
  }
  stageCommands(dialogPrebuiltDir, targetName, dialogConfig, ['dgdebug', 'dialogc']);

  const aamachineConfig = aamachineTargets[targetName];
  if (!aamachineConfig) {
    throw new Error(`No aamachine target mapping for "${targetName}" in ${VERSION_FILE}`);
  }
  stageCommands(aamachinePrebuiltDir, targetName, aamachineConfig, ['aambundle']);
}

async function main() {
  const target = parseArgs();
  const versions = loadVersions();

  fs.rmSync(BIN_DIR, { recursive: true, force: true });

  const dialogPrebuiltDir = await ensureExtracted('Dialog-IF/dialog', 'dialog', versions.dialog);
  const dialogExtractedDir = path.dirname(dialogPrebuiltDir);
  stageLibrary(dialogExtractedDir);

  if (target === 'none') {
    console.log('Cleared bin/ (no bundled platform binaries staged)');
    return;
  }

  const aamachinePrebuiltDir = await ensureExtracted('Dialog-IF/aamachine', 'aamachine', versions.aamachine);

  if (target === 'all') {
    for (const name of Object.keys(versions.dialog.targets)) {
      await stageTarget(name, dialogPrebuiltDir, versions.dialog.targets, aamachinePrebuiltDir, versions.aamachine.targets);
    }
    return;
  }

  await stageTarget(target, dialogPrebuiltDir, versions.dialog.targets, aamachinePrebuiltDir, versions.aamachine.targets);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
