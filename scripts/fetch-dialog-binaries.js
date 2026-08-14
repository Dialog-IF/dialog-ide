#!/usr/bin/env node
/**
 * Downloads the pinned Dialog-IF/dialog release and stages its prebuilt dgdebug/dialogc
 * binaries into bin/<vsce-target>/ for packaging, plus its stdlib.dg/stddebug.dg/unit.dg
 * standard library sources into bin/dialog-lib/ (platform-independent, staged for every target
 * including "none" - see stageLibrary). Run manually before a targeted `vsce package`/
 * `vsce publish` pass - see the release-to-marketplace skill. Never run as part of
 * `npm test`/`npm run build` or CI.
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

function loadVersion() {
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
 * Returns the cached-and-verified `prebuilt/` dir for the pinned release, downloading and
 * extracting it first if this is the first invocation for this tag.
 */
async function ensureExtracted(version) {
  const zipName = `dialog-${version.tag.replace(/^release-/, '')}.zip`;
  const releaseCacheDir = path.join(CACHE_DIR, version.tag);
  const extractedDir = path.join(releaseCacheDir, zipName.replace(/\.zip$/, ''));
  const prebuiltDir = path.join(extractedDir, 'prebuilt');

  if (fs.existsSync(prebuiltDir)) {
    return prebuiltDir;
  }

  fs.mkdirSync(releaseCacheDir, { recursive: true });
  const zipPath = path.join(releaseCacheDir, zipName);

  if (!fs.existsSync(zipPath)) {
    const url = `https://github.com/Dialog-IF/dialog/releases/download/${version.tag}/${zipName}`;
    console.log(`Downloading ${url}`);
    await download(url, zipPath);
  }

  const expectedSha = version.sha256[zipName];
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

function stageTarget(prebuiltDir, targetName, targetConfig) {
  const src = path.join(prebuiltDir, targetConfig.upstreamDir);
  const dest = path.join(BIN_DIR, targetName);
  fs.mkdirSync(dest, { recursive: true });

  for (const command of ['dgdebug', 'dialogc']) {
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
  console.log(`Staged bin/${targetName}/{dgdebug,dialogc}${targetConfig.exeSuffix}`);
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

async function main() {
  const target = parseArgs();
  const version = loadVersion();

  fs.rmSync(BIN_DIR, { recursive: true, force: true });

  const prebuiltDir = await ensureExtracted(version);
  const extractedDir = path.dirname(prebuiltDir);
  stageLibrary(extractedDir);

  if (target === 'none') {
    console.log('Cleared bin/ (no bundled platform binaries staged)');
    return;
  }

  if (target === 'all') {
    for (const [name, config] of Object.entries(version.targets)) {
      stageTarget(prebuiltDir, name, config);
    }
    return;
  }

  const config = version.targets[target];
  if (!config) {
    throw new Error(
      `Unknown target "${target}" - expected one of: ${Object.keys(version.targets).join(', ')}, all, none`
    );
  }
  stageTarget(prebuiltDir, target, config);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
