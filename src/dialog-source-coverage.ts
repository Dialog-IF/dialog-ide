/**
 * Logic for adding a discovered .dg file into dialog.json's declared sources, plus the static
 * category descriptions shown in the "Add File to dialog.json..." QuickPick. Deliberately
 * vscode-free (like session-runner.ts) so it's unit-testable without mocking the extension host -
 * extension.ts owns the QuickPick/notification glue around this.
 */

import * as fs from 'fs';
import * as path from 'path';
import { modify, applyEdits } from 'jsonc-parser';
import { ProjectSources } from './dialoged/skein';

export type SourceCategory = keyof ProjectSources;

export const SOURCE_CATEGORIES: ReadonlyArray<{ category: SourceCategory; description: string }> = [
  { category: 'main', description: 'Compiled into every run - the default category' },
  { category: 'test', description: 'Only loaded when running tests' },
  { category: 'debug', description: 'Only loaded under the interactive debugger' },
  { category: 'library', description: 'Shared library code' }
];

/**
 * Appends `relativePath` to `category`'s array in the dialog.json at `dialogJsonPath`, creating
 * the array if that category isn't declared yet. Edits via jsonc-parser's modify/applyEdits
 * rather than JSON.parse+stringify so the file's existing formatting and comments survive.
 */
export function addSourceToDialogJson(dialogJsonPath: string, category: SourceCategory, relativePath: string): void {
  const text = fs.readFileSync(dialogJsonPath, 'utf8');
  const parsed = JSON.parse(text) as { sources?: Partial<ProjectSources> };
  const existingLength = parsed.sources?.[category]?.length ?? 0;

  const edits = modify(text, ['sources', category, existingLength], relativePath, {
    isArrayInsertion: true,
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  fs.writeFileSync(dialogJsonPath, applyEdits(text, edits), 'utf8');
}

/** POSIX-style (forward-slash) path relative to rootDir, matching how dialog.json entries are conventionally written. */
export function toDialogJsonPath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}
