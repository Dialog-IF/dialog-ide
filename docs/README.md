# Dialog IDE manual (Antora source)

This directory is a self-contained [Antora](https://antora.org) documentation component for the
Dialog IDE VS Code extension. It is authored here, in the extension's own repository, so it stays in
sync with the code, and is consumed by the main Dialog website's Antora build as an additional
content source.

## Layout

```
docs/
  antora.yml                     component descriptor (name: dialog-ide, versionless)
  modules/ROOT/
    nav.adoc                     the manual's table of contents
    pages/*.adoc                 one file per chapter
    partials/*.adoc              fragments reused across chapters
    images/                      screenshots; MANIFEST.adoc is the shot-list
```

## Wiring into the Dialog website playbook

In the Dialog site's `antora-playbook.yml`, add this repo under `content.sources` with `start_path`
set to `docs`:

```yaml
content:
  sources:
    # ...existing Dialog sources...
    - url: https://github.com/hlship/dialog-ide.git
      branches: [main]        # or a release branch/tag once one exists
      start_path: docs
```

The component id is `dialog-ide`; cross-links from elsewhere on the site use
`xref:dialog-ide::index.adoc[]` (and so on).

## Local preview

There is no committed playbook for local builds. To preview:

1. `npm i -g @antora/cli@3 @antora/site-generator@3`
2. Create a throwaway `local-playbook.yml`:
   ```yaml
   site:
     title: Dialog IDE (local preview)
     start_page: dialog-ide::index.adoc
   content:
     sources:
       - url: .
         start_path: docs
   ui:
     bundle:
       url: https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/HEAD/raw/build/ui-bundle.zip?job=bundle-stable
       snapshot: true
   output:
     dir: ./docs/_preview
   ```
3. `antora --fetch local-playbook.yml` and open `docs/_preview/index.html`.

`docs/_preview/` and any local playbook are build artifacts — do not commit them.
