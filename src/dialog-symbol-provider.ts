/**
 * Thin vscode.DocumentSymbolProvider adapter over dialog-outline.ts's pure parser - powers the
 * Outline view, breadcrumbs, and Ctrl+Shift+O for .dg files. Registered against the `dialog`
 * language id (contributed by this extension's own package.json - see syntaxes/) in
 * extension.ts's activate().
 */

import * as vscode from 'vscode';
import { DialogPosition, DialogSymbol, parseDialogOutline } from './dialog-outline';

function toPosition(position: DialogPosition): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

function toVscodeSymbol(symbol: DialogSymbol): vscode.DocumentSymbol {
  const range = new vscode.Range(toPosition(symbol.range.start), toPosition(symbol.range.end));
  const selectionRange = new vscode.Range(
    toPosition(symbol.selectionRange.start),
    toPosition(symbol.selectionRange.end)
  );
  const kind = symbol.kind === 'topic' ? vscode.SymbolKind.Class : vscode.SymbolKind.Function;
  const result = new vscode.DocumentSymbol(symbol.name, '', kind, range, selectionRange);
  result.children = symbol.children.map(toVscodeSymbol);
  return result;
}

export class DialogDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    return parseDialogOutline(document.getText()).map(toVscodeSymbol);
  }
}
