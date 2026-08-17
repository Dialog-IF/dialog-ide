import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addFeelie, removeFeelie } from './dialog-feelies';

describe('addFeelie', () => {
  let tmpDir: string;
  let dialogJsonPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-feelies-'));
    dialogJsonPath = path.join(tmpDir, 'dialog.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the feelies array when it does not exist yet', () => {
    fs.writeFileSync(dialogJsonPath, JSON.stringify({ name: 'Test', sources: { main: ['src'] } }, null, 2));

    addFeelie(dialogJsonPath, { path: 'intro.pdf', name: 'Introduction to IF' });

    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.feelies).toEqual([{ path: 'intro.pdf', name: 'Introduction to IF' }]);
  });

  it('appends to an existing feelies array without disturbing other entries', () => {
    fs.writeFileSync(
      dialogJsonPath,
      JSON.stringify(
        { name: 'Test', sources: { main: ['src'] }, feelies: [{ path: 'intro.pdf', name: 'Introduction to IF' }] },
        null,
        2
      )
    );

    addFeelie(dialogJsonPath, { path: 'card.pdf', name: 'IF in One Page' });

    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.feelies).toEqual([
      { path: 'intro.pdf', name: 'Introduction to IF' },
      { path: 'card.pdf', name: 'IF in One Page' }
    ]);
  });
});

describe('removeFeelie', () => {
  let tmpDir: string;
  let dialogJsonPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-feelies-'));
    dialogJsonPath = path.join(tmpDir, 'dialog.json');
    fs.writeFileSync(
      dialogJsonPath,
      JSON.stringify(
        {
          name: 'Test',
          sources: { main: ['src'] },
          feelies: [
            { path: 'intro.pdf', name: 'Introduction to IF' },
            { path: 'card.pdf', name: 'IF in One Page' }
          ]
        },
        null,
        2
      )
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the matching entry, leaving others intact', () => {
    removeFeelie(dialogJsonPath, 'intro.pdf');
    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.feelies).toEqual([{ path: 'card.pdf', name: 'IF in One Page' }]);
  });

  it('throws when the path is not found', () => {
    expect(() => removeFeelie(dialogJsonPath, 'does-not-exist.pdf')).toThrow('does-not-exist.pdf');
  });
});
