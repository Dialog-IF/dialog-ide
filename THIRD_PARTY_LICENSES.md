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

## `bin/` — bundled `dgdebug`/`dialogc` binaries

Platform-specific builds of this extension (`win32-x64`, `darwin-arm64`, `linux-x64`) bundle the
`dgdebug` and `dialogc` binaries under `bin/<target>/`. These are unmodified, prebuilt
redistributions from the [Dialog-IF/dialog](https://github.com/Dialog-IF/dialog) project — a
community-maintained fork of the Dialog interactive fiction language originally created by
Linus Åkesson — taken from the release pinned in `scripts/dialog-toolchain-version.json`
(currently `release-1c02-1.2.3`). They are staged at package time by
`scripts/fetch-dialog-binaries.js` and are not bundled in the universal (no-target) package,
which continues to rely on `PATH`/`dialog.json`'s `binDir` like every prior release of this
extension.

The upstream `license.txt` (2-clause-BSD-style, permitting binary redistribution with the
copyright notice retained), reproduced verbatim:

```
Copyright 2018-2026 Linus Åkesson and the Dialog Project contributors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

	1. Redistributions of source code must retain the above copyright
	notice, this list of conditions and the following disclaimer.

	2. Redistributions in binary form must reproduce the above copyright
	notice, this list of conditions and the following disclaimer in the
	documentation and/or other materials provided with the distribution.

	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
	IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
	TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
	PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
	HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
	SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
	DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
	THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
	(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
	OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

This license is intended to apply to the Dialog compiler and debugger and
the source code of the standard libraries. Any time those components are
distributed, this copyright notice should be attached. But it is not meant
to limit what the compiler's output can be used for, even for projects that
include the standard libraries. To make this explicit, the project is ALSO
released under a modified two-clause BSD license, which is exactly the same
as the above but adds this exception:

	As an exception, if, as a result of you compiling your source code,
	portions of this software are embedded into compiler output in binary
	form, you may redistribute such embedded portions without complying
	with condition 2 of the license.

In other words, you can distribute the Z-machine and Å-machine bytecode that
the compiler produces in any way you like, without needing to include this
license file or comply with the attribution requirements (for the library
or for the Z-machine runtime routines).
```

(The full upstream `license.txt` also covers the Windows GUI debugger's bundled Glk/WinGlk/libogg/
libvorbis components — this extension does not bundle `dgdebug_gui.exe` or `Glk.dll`, only the
console `dgdebug`/`dialogc` binaries covered by the BSD-style block above.)

## `bin/` — bundled `aambundle` binary

The same platform-specific builds also bundle `aambundle` under `bin/<target>/`, alongside
`dgdebug`/`dialogc`. This is an unmodified, prebuilt redistribution from the
[Dialog-IF/aamachine](https://github.com/Dialog-IF/aamachine) project (the Å-machine, used by
"Export Web Page..." to produce an in-browser player for the exported story), taken from the
release pinned in `scripts/dialog-toolchain-version.json` (currently `release-1.0.1`) and staged
by the same `scripts/fetch-dialog-binaries.js`. Only `aambundle` itself is bundled — not
`aamrun`/`aamshow`, which this extension doesn't use.

The upstream `license.txt` (2-clause-BSD-style, permitting binary redistribution with the
copyright notice retained), reproduced verbatim:

```
Copyright 2019-2026 Linus Åkesson and the Dialog Project

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

	1. Redistributions of source code must retain the above copyright
	notice, this list of conditions and the following disclaimer.

	2. Redistributions in binary form must reproduce the above copyright
	notice, this list of conditions and the following disclaimer in the
	documentation and/or other materials provided with the distribution.

	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
	IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
	TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
	PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
	HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
	SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
	DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
	THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
	(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
	OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Note that the aambundle tool will automatically insert a license file that
complies with these requirements.
```

(The full upstream `license.txt` also covers jquery/minimist, redistributed by `aambundle`
itself inside the web-player output it generates at export time — not something this extension
vendors separately — and a public-domain 6502 emulator used only by `aambox6502`, which this
extension does not bundle.)

## `resources/bundle/` — vendored web-export assets

`default-cover.png`, `style.css`, `play.css`, `introduction-to-if.pdf`, and `play-if-card.pdf`
under `resources/bundle/` are copied from the
[dialog-tool](https://github.com/hlship/dialog-tool) project (the same author, also Apache-2.0
licensed) to keep "Export Web Page..." at feature parity with dialog-tool's own `dgt bundle`.
