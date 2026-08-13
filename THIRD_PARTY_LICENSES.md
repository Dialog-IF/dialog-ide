# Third-Party Licenses

## `syntaxes/dialog.tmLanguage.json` and `language-configuration.json`

These two files are vendored, essentially verbatim, from the
[`dialog-language-support`](https://github.com/sideburns3000/vscode-dialog-language) VS Code
extension (version 1.1.0), by Michael Lauenstein. They provide the TextMate grammar and editor
configuration (comments, brackets, folding, indentation, word pattern) for Dialog's `.dg` source
files.

Nothing else from that extension was carried over — in particular its `dialog.compileTo*`
commands, `dialog` task type, problem matcher, and `dialog.compiler`/`dialog.includeWhenCompiling`
settings were deliberately not reimplemented or derived from, since Dialog IDE has its own
project-level build/export tooling planned that will cover the same ground independently.

The original extension is MIT licensed:

```
MIT License

Copyright (c) 2019 Michael Lauenstein

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
