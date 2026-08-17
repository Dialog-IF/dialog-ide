/**
 * HTML for "Export Web Page..."'s out/web/index.html - a plain TypeScript template-literal
 * function, matching render.ts/tree-pane.ts's convention (no template-engine dependency), rather
 * than porting dialog-tool's Selmer-rendered resources/bundle/index.html verbatim. Field-for-field
 * parity with that page: title/author in <title>/meta tags, an optional cover thumbnail linking
 * to the full-size image, title/author/release headers, one list item per compiled story file,
 * a link for each of the project's configured feelies (see FeelieLink), a "Play In-Browser" link
 * to play.html (produced by aambundle itself, not by this function), an optional walkthrough
 * link, the story's blurb, and a closing paragraph naming the IFID and recommending interpreters.
 */

/** A single compiled game file, ready for download - built by dialog-web-export.ts's buildStoryFile. */
export interface BuiltTarget {
  target: string;
  path: string;
  name: string;
  description: string;
}

/** Story metadata queried live from dgdebug via dialog-web-export.ts's extractStoryInfo. */
export interface StoryInfo {
  title: string;
  author: string;
  ifid: string;
  noun: string;
  blurb: string;
  release: string;
}

/**
 * A feelie link actually present in this export's out/web/ - one per entry in the project's
 * dialog.json `feelies` config (see dialog-web-export.ts's resolveFeelieLinks). `ext` is the
 * source file's extension (no dot), used for the page's "(ext, description)" subtitle.
 */
export interface FeelieLink {
  name: string;
  label: string;
  description: string;
  ext: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WebExportPageContext {
  story: StoryInfo;
  storyFiles: BuiltTarget[];
  hasCover: boolean;
  feelieLinks: FeelieLink[];
  walkthroughDescription: string | null;
}

export function renderWebExportPage(context: WebExportPageContext): string {
  const { story, storyFiles, hasCover, feelieLinks, walkthroughDescription } = context;
  const title = escapeHtml(story.title);
  const author = escapeHtml(story.author);

  const coverHtml = hasCover
    ? `<div class="coverimage"><span><a href="cover.png"><img src="cover-small.png" border="1"></a></span></div>`
    : '';

  const storyFilesHtml = storyFiles
    .map(
      (file) =>
        `\t\t<li><div class="download"><a href="${escapeHtml(file.name)}">Story File</a> <span class="filetype">(${escapeHtml(file.description)})</span></div></li>`
    )
    .join('\n');

  const feelieLinksHtml = feelieLinks
    .map(
      (feelie) =>
        `\t\t<li><a href="${escapeHtml(feelie.name)}">${escapeHtml(feelie.label)}</a> <span class="filetype">(${escapeHtml(feelie.ext)}, ${escapeHtml(feelie.description)})</span></li>`
    )
    .join('\n');

  const walkthroughHtml = walkthroughDescription
    ? `\t\t<li><a href="walkthrough.txt">Walkthrough</a> <span class="filetype">(${escapeHtml(walkthroughDescription)})</span></li>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html><head>
  <title>${author} - ${title}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="author" content="${author}">
  <meta name="description" content="A page for the ${title} by ${author}.">
  <link rel="stylesheet" href="style.css" type="text/css"/>
</head>
<body>
<div class="container">
${coverHtml}
<div class="introduction">
\t<h1><span>${title}</span></h1>
\t<h2><span>${author}</span></h2>
\t<div class="bibliography"><span>Release ${escapeHtml(story.release)}</span></div>
</div>
<div class="links">
\t<ul>
${storyFilesHtml}
\t<div class="auxiliary">
${feelieLinksHtml}
\t\t<li><a href="play.html">Play In-Browser</a> <span class="filetype">(link)</span></li></div>
${walkthroughHtml}
\t</ul>
</div>

<div class="about"><span><p>${escapeHtml(story.blurb)}</p></span></div>

<div class="playinfo">
\t<p>${title} was created with <a href="https://github.com/dialog-if/dialog">Dialog</a>
 and has IFID ${escapeHtml(story.ifid)}. To play a work like
this one, you need an interpreter program: many are available, among
them <a href="http://ccxvii.net/spatterlight/">Spatterlight
for Mac OS X</a>, <a href="http://www.logicalshift.demon.co.uk/unix/zoom/">Zoom for Unix</a>, or
<a href="http://freespace.virgin.net/davidk.kinder/frotz.html">Frotz for Windows</a>.
Or you can play without downloading anything by following the "Play In-Browser"
link, using the AAmachine interpreter. You'll need to have JavaScript enabled
on your web browser.</p>
</div>

</div>
</body></html>
`;
}
