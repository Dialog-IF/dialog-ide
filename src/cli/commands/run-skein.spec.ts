import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkeinTree, WireKnot } from '../../dialoged/skein';
import { countKnotStatuses, deriveSkeinExitCode, runSkeinCommand } from './run-skein';

function knot(overrides: Partial<WireKnot> & Pick<WireKnot, 'id' | 'command'>): WireKnot {
  return {
    parentId: overrides.id === 0 ? null : 0,
    response: null,
    unblessedResponse: null,
    label: null,
    locked: false,
    marker: null,
    ...overrides
  };
}

describe('deriveSkeinExitCode', () => {
  it('is 0 when no knot is in an error state', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 42, [
      knot({ id: 0, command: '', response: { text: 'start', inputType: 'line' } }),
      knot({
        id: 1,
        command: 'look',
        response: { text: 'a room', inputType: 'line' },
        unblessedResponse: { text: 'a room', inputType: 'line' }
      })
    ]);

    expect(deriveSkeinExitCode(tree)).toBe(0);
  });

  it('is 1 when any knot\'s live response no longer matches its blessed response', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 42, [
      knot({ id: 0, command: '', response: { text: 'start', inputType: 'line' } }),
      knot({
        id: 1,
        command: 'take orb',
        response: { text: 'You take the orb.', inputType: 'line' },
        unblessedResponse: { text: 'You grab the orb.', inputType: 'line' }
      })
    ]);

    expect(deriveSkeinExitCode(tree)).toBe(1);
  });
});

describe('countKnotStatuses', () => {
  it('counts every knot exactly once, split by status', () => {
    const tree = SkeinTree.fromKnots('dgdebug', 42, [
      knot({ id: 0, command: '', response: { text: 'start', inputType: 'line' } }),
      knot({
        id: 1,
        command: 'look',
        response: { text: 'a room', inputType: 'line' },
        unblessedResponse: { text: 'a room', inputType: 'line' }
      }),
      knot({ id: 2, parentId: 1, command: 'wait' }), // response: null -> 'new'
      knot({
        id: 3,
        parentId: 1,
        command: 'take orb',
        response: { text: 'You take the orb.', inputType: 'line' },
        unblessedResponse: { text: 'You grab the orb.', inputType: 'line' }
      })
    ]);

    // knot 0 has a response with no unblessedResponse conflict -> 'valid'; knot 1 similarly
    // 'valid'; knot 2 has no response at all -> 'new'; knot 3's response/unblessedResponse
    // mismatch -> 'error'.
    expect(countKnotStatuses(tree)).toEqual({ valid: 2, new: 1, error: 1 });
  });
});

describe('runSkeinCommand validation', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-run-skein-'));
    fs.writeFileSync(path.join(tempRoot, 'dialog.json'), JSON.stringify({ sources: { main: [] } }));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('rejects a session name that looks like a path', async () => {
    await expect(runSkeinCommand(['../escape'], { project: tempRoot })).rejects.toThrow('not a valid skein name');
  });

  it('rejects a session id that does not exist on disk', async () => {
    await expect(runSkeinCommand(['nonexistent'], { project: tempRoot })).rejects.toThrow('not found');
  });

  it('reports every missing skein when given multiple names, not just the first', async () => {
    await expect(runSkeinCommand(['nonexistent-1', 'nonexistent-2'], { project: tempRoot })).rejects.toThrow(
      'nonexistent-1.skein, nonexistent-2.skein'
    );
  });

  it('rejects when the project directory has no dialog.json at all', async () => {
    const noProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgbuild-run-skein-noproj-'));
    try {
      await expect(runSkeinCommand(['default'], { project: noProjectDir })).rejects.toThrow('does not exist');
    } finally {
      fs.rmSync(noProjectDir, { recursive: true, force: true });
    }
  });

  it('defaults to "default" when no names are given, still validating it exists', async () => {
    await expect(runSkeinCommand([], { project: tempRoot })).rejects.toThrow('default.skein');
  });
});
