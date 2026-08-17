/**
 * Logic for "Add Feelie..." and "Remove Feelie..." - deliberately vscode-free (like
 * dialog-export.ts/dialog-source-coverage.ts) so it's unit-testable without mocking the
 * extension host. extension.ts owns the showOpenDialog/showInputBox/QuickPick wizard glue and
 * calls into these functions with the collected answers.
 */

import * as fs from 'fs';
import { modify, applyEdits } from 'jsonc-parser';
import { FeelieConfig } from './dialoged/skein';

/**
 * Appends `feelie` to dialog.json's `feelies` array, creating the array if it doesn't exist yet.
 * Edits via jsonc-parser's modify/applyEdits (like addExportConfig) so the file's existing
 * formatting and comments survive.
 */
export function addFeelie(dialogJsonPath: string, feelie: FeelieConfig): void {
  const text = fs.readFileSync(dialogJsonPath, 'utf8');
  const parsed = JSON.parse(text) as { feelies?: FeelieConfig[] };
  const existingLength = parsed.feelies?.length ?? 0;

  const edits = modify(text, ['feelies', existingLength], feelie, {
    isArrayInsertion: true,
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  fs.writeFileSync(dialogJsonPath, applyEdits(text, edits), 'utf8');
}

/**
 * Removes the entry matching `feeliePath` from dialog.json's `feelies` array. Unlike
 * removeExportConfig's silent no-op, throws if no entry matches - the user asked to remove a
 * specific feelie, and a name that doesn't exist is a mistake worth surfacing rather than
 * quietly doing nothing.
 */
export function removeFeelie(dialogJsonPath: string, feeliePath: string): void {
  const text = fs.readFileSync(dialogJsonPath, 'utf8');
  const parsed = JSON.parse(text) as { feelies?: FeelieConfig[] };
  const index = (parsed.feelies ?? []).findIndex((entry) => entry.path === feeliePath);
  if (index === -1) {
    throw new Error(`Feelie "${feeliePath}" not found in dialog.json.`);
  }

  const edits = modify(text, ['feelies', index], undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  fs.writeFileSync(dialogJsonPath, applyEdits(text, edits), 'utf8');
}
