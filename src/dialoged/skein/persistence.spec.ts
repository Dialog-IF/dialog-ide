import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { serializeTree, deserializeTree, PersistenceManager } from './persistence';
import { SkeinTree } from './tree';

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('serializeTree / deserializeTree', () => {
  it('round-trips engine and seed through the header', () => {
    const tree = SkeinTree.newTree('frotz', 42);
    const reloaded = deserializeTree(serializeTree(tree));
    expect(reloaded.getEngine()).toBe('frotz');
    expect(reloaded.getSeed()).toBe(42);
  });

  it('sets the reloaded tree\'s active knot to the leaf of the saved spine, not root (regression - a loaded multi-knot skein was only showing knot 0)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a room\n', inputType: 'line' })
      .addChild(1, 'take orb', { text: 'you take it\n', inputType: 'line' })
      .setActiveKnotId(2);
    const reloaded = deserializeTree(serializeTree(tree));
    expect(reloaded.getActiveKnotId()).toBe(2);
  });

  it('writes engine with a leading colon (Clojure keyword form) for dialog-tool compatibility', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    expect(serializeTree(tree)).toContain('engine: :dgdebug');
  });

  it('accepts engine with or without the leading colon on read', () => {
    expect(deserializeTree('seed: 1\nengine: :frotz-release\n').getEngine()).toBe('frotz-release');
    expect(deserializeTree('seed: 1\nengine: frotz-release\n').getEngine()).toBe('frotz-release');
  });

  it('defaults engine to dgdebug when the header omits it', () => {
    expect(deserializeTree('seed: 1\n').getEngine()).toBe('dgdebug');
  });

  it('never writes a command line for the root knot', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const lines = serializeTree(tree).split('\n');
    const idIndex = lines.indexOf('id: 0');
    // the root's props block ends at the next separator; no "command:" line should appear before it
    const nextSeparator = lines.findIndex((line, i) => i > idIndex && /^-{4,}$/.test(line));
    const rootPropsBlock = lines.slice(idIndex, nextSeparator);
    expect(rootPropsBlock.some((line) => line.startsWith('command:'))).toBe(false);
  });

  it('writes locked only when true, and label only when present', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' });
    const withLabelAndLock = tree.setLabel(1, 'checkpoint').setLockStatus(1, true);
    const serialized = serializeTree(withLabelAndLock);
    expect(serialized).toContain('label: checkpoint');
    expect(serialized).toContain('locked: true');

    // Root always carries "label: START", so check knot 1 specifically rather than the
    // whole file: it should round-trip with no label and unlocked when neither was set.
    const reloaded = deserializeTree(serializeTree(tree));
    expect(reloaded.getKnot(1)!.label).toBeNull();
    expect(reloaded.getKnot(1)!.locked).toBe(false);
  });

  it('maps keystroke prompts to the file\'s "prompt: keystroke" field, and omits it for line prompts', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'y', { text: 'Are you sure?', inputType: 'key' })
      .addChild(0, 'look', { text: 'You see nothing.', inputType: 'line' });
    const serialized = serializeTree(tree);
    expect(serialized).toContain('prompt: keystroke');

    const reloaded = deserializeTree(serialized);
    expect(reloaded.getKnot(1)?.unblessedResponse?.inputType).toBe('key');
    expect(reloaded.getKnot(2)?.unblessedResponse?.inputType).toBe('line');
  });

  it('separates blessed and unblessed response text with the unblessed delimiter, not >>>>', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'Old response.\n', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'New response.\n', inputType: 'line' });
    const serialized = serializeTree(tree);

    expect(serialized).toContain('<'.repeat(80));
    expect(serialized).not.toContain('>>>>');

    const reloaded = deserializeTree(serialized);
    const knot = reloaded.getKnot(1)!;
    expect(knot.response?.text).toBe('Old response.\n');
    expect(knot.unblessedResponse?.text).toBe('New response.\n');
  });

  it('does not force an extra trailing newline beyond what the content already has', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'No trailing newline here', inputType: 'line' });
    const serialized = serializeTree(tree);
    expect(serialized.endsWith('\n')).toBe(false);
  });
});

describe('deserializeTree against real dialog-tool fixtures', () => {
  it('parses dgsample.skein (branching tree, ANSI-free)', () => {
    const tree = deserializeTree(readFixture('dgsample.skein'));
    expect(tree.getEngine()).toBe('dgdebug');
    expect(tree.getSeed()).toBe(42);
    expect(tree.getAllKnots()).toHaveLength(8);

    const root = tree.getKnot(0)!;
    expect(root.label).toBe('START');
    expect(root.parentId).toBeNull();
    expect(root.response?.text).toContain('The Featureless Space');

    // root has two children in the source file (parent-id: 0 appears twice)
    expect(tree.getDerivedKnot(0)?.children).toEqual([1772224627854, 1772224627858]);
  });

  it('parses keyinput.skein (keystroke prompts, ANSI escapes, multiple branches from one keystroke knot)', () => {
    const tree = deserializeTree(readFixture('keyinput.skein'));
    expect(tree.getAllKnots()).toHaveLength(12);

    const keystrokeKnot = tree.getKnot(1781460447847)!;
    expect(keystrokeKnot.response?.inputType).toBe('key');
    expect(keystrokeKnot.command).toBe('turn it off');

    // ANSI escape sequences in the response text should survive parsing untouched
    expect(tree.getKnot(0)!.response?.text).toContain('[1m');

    // 1781460447851 branches to two children: 1781460447852 and 1781556551982
    expect(tree.getDerivedKnot(1781460447851)?.children).toEqual([1781460447852, 1781556551982]);
  });

  it('round-trips each fixture byte-identical at the knot data level', () => {
    for (const name of ['dgsample.skein', 'keyinput.skein']) {
      const original = deserializeTree(readFixture(name));
      const roundTripped = deserializeTree(serializeTree(original));

      const a = original.getAllKnots().sort((x, y) => x.id - y.id);
      const b = roundTripped.getAllKnots().sort((x, y) => x.id - y.id);
      expect(b).toEqual(a);
      expect(roundTripped.getEngine()).toBe(original.getEngine());
      expect(roundTripped.getSeed()).toBe(original.getSeed());
    }
  });
});

describe('PersistenceManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skein-persistence-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and loads a session round-trip through the filesystem', async () => {
    const manager = new PersistenceManager(tempDir);
    const tree = SkeinTree.newTree('dgdebug', 99)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' });

    await manager.saveSession(tree, 'my-session');
    const filePath = path.join(tempDir, 'my-session.skein');
    expect(fs.existsSync(filePath)).toBe(true);

    const reloaded = await manager.loadSession('my-session');
    expect(reloaded.getEngine()).toBe('dgdebug');
    expect(reloaded.getSeed()).toBe(99);
    expect(reloaded.getAllKnots()).toHaveLength(2);
  });

  it('saves atomically: no leftover .tmp file after a successful save', async () => {
    const manager = new PersistenceManager(tempDir);
    await manager.saveSession(SkeinTree.newTree('dgdebug', 1), 'atomic-check');
    expect(fs.existsSync(path.join(tempDir, 'atomic-check.skein.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, 'atomic-check.skein'))).toBe(true);
  });

  it('rejects loading a session that was never saved', async () => {
    const manager = new PersistenceManager(tempDir);
    await expect(manager.loadSession('does-not-exist')).rejects.toThrow();
  });

  describe('listSessions', () => {
    it('returns the sorted ids of saved sessions, extension stripped', async () => {
      const manager = new PersistenceManager(tempDir);
      await manager.saveSession(SkeinTree.newTree('dgdebug', 1), 'zebra');
      await manager.saveSession(SkeinTree.newTree('dgdebug', 1), 'apple');
      expect(await manager.listSessions()).toEqual(['apple', 'zebra']);
    });

    it('ignores non-.skein files in basePath', async () => {
      const manager = new PersistenceManager(tempDir);
      await manager.saveSession(SkeinTree.newTree('dgdebug', 1), 'real-session');
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'hello');
      expect(await manager.listSessions()).toEqual(['real-session']);
    });

    it('returns an empty array rather than throwing when basePath does not exist yet', async () => {
      const manager = new PersistenceManager(path.join(tempDir, 'never-created'));
      expect(await manager.listSessions()).toEqual([]);
    });
  });

  describe('sessionExists', () => {
    it('is true for a saved session and false otherwise', async () => {
      const manager = new PersistenceManager(tempDir);
      await manager.saveSession(SkeinTree.newTree('dgdebug', 1), 'present');
      expect(await manager.sessionExists('present')).toBe(true);
      expect(await manager.sessionExists('absent')).toBe(false);
    });

    it('is false (not throwing) when basePath does not exist yet', async () => {
      const manager = new PersistenceManager(path.join(tempDir, 'never-created'));
      expect(await manager.sessionExists('anything')).toBe(false);
    });
  });
});
