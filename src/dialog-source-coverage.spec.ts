import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addSourceToDialogJson, toDialogJsonPath, SOURCE_CATEGORIES } from './dialog-source-coverage';

describe('addSourceToDialogJson', () => {
  let tmpDir: string;
  let dialogJsonPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-source-coverage-'));
    dialogJsonPath = path.join(tmpDir, 'dialog.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the category array when it does not exist yet', () => {
    fs.writeFileSync(dialogJsonPath, JSON.stringify({ name: 'Test', sources: { main: ['src'] } }, null, 2));

    addSourceToDialogJson(dialogJsonPath, 'test', 'tests/scratch.dg');

    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.sources.test).toEqual(['tests/scratch.dg']);
    expect(written.sources.main).toEqual(['src']);
  });

  it('appends to an existing category array without disturbing other entries', () => {
    fs.writeFileSync(
      dialogJsonPath,
      JSON.stringify({ name: 'Test', sources: { main: ['src', 'extra.dg'] } }, null, 2)
    );

    addSourceToDialogJson(dialogJsonPath, 'main', 'scratch.dg');

    const written = JSON.parse(fs.readFileSync(dialogJsonPath, 'utf8'));
    expect(written.sources.main).toEqual(['src', 'extra.dg', 'scratch.dg']);
  });

  it('leaves unrelated formatting untouched rather than reserializing the whole file', () => {
    fs.writeFileSync(
      dialogJsonPath,
      ['{', '  "name": "Test",', '  "binDir": "/opt/dialog/bin",', '  "sources": { "main": ["src"] }', '}', ''].join(
        '\n'
      )
    );

    addSourceToDialogJson(dialogJsonPath, 'main', 'scratch.dg');

    const text = fs.readFileSync(dialogJsonPath, 'utf8');
    expect(text).toContain('"binDir": "/opt/dialog/bin",');
    expect(JSON.parse(text).sources.main).toEqual(['src', 'scratch.dg']);
  });
});

describe('toDialogJsonPath', () => {
  it('converts an absolute path under rootDir to a forward-slash relative path', () => {
    const rootDir = path.join('project', 'root');
    const filePath = path.join(rootDir, 'src', 'scratch.dg');
    expect(toDialogJsonPath(rootDir, filePath)).toBe('src/scratch.dg');
  });
});

describe('SOURCE_CATEGORIES', () => {
  it('lists all four declared source categories', () => {
    expect(SOURCE_CATEGORIES.map((entry) => entry.category)).toEqual(['main', 'test', 'debug', 'library']);
  });
});
