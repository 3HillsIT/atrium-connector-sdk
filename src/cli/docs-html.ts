// The docs as one HTML file: every page of docs/*.md in the guide's order, in
// one self-contained document (no network, light and dark, Brand v2 colours),
// so a developer reads them in a browser without a Markdown viewer.
//
// `scripts/build-docs.ts` writes it when the package is packed or published
// (`prepack`), and `atrium-connector docs` opens it. It is generated, never
// edited and never committed: test/docs-html.test.ts builds it from the
// Markdown again and checks the file in the package against that.
//
// A link between pages (`rules.md#the-write-flag`) becomes a jump mark
// (`#rules--the-write-flag`): each heading's id gets its page's name in front
// so two pages with the same heading don't clash.

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { GUIDE_PAGES } from '../build';
import type { GuidePage } from '../build';

const SDK_ROOT = resolve(import.meta.dir, '..', '..');
/** The HTML file's name, at the root of the package. */
export const DOCS_HTML_FILE = 'atrium-connector-docs.html';
/** Where it is, once `prepack` has written it (a source checkout has none until then). */
export const DOCS_HTML_PATH = join(SDK_ROOT, DOCS_HTML_FILE);

export interface DocsPage {
  page: GuidePage;
  title: string;
  html: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One page's Markdown as HTML whose ids and links belong to the combined document. */
export function renderPage(page: GuidePage, markdown: string): DocsPage {
  const title = /^# +(.+?) *$/m.exec(markdown)?.[1] ?? page;
  const html = Bun.markdown
    .html(markdown, { headings: { ids: true } })
    .replace(/(<h[1-6] id=")([^"]*)"/g, (_, open: string, id: string) => `${open}${page}--${id}"`)
    .replace(/<table>/g, '<div class="table"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/href="([a-z-]+)\.md(?:#([^"]*))?"/g, (whole, target: string, anchor?: string) =>
      (GUIDE_PAGES as readonly string[]).includes(target)
        ? `href="#${anchor === undefined ? target : `${target}--${anchor}`}"`
        : whole,
    );
  return { page, title, html };
}

export function readPages(docsDirectory = join(SDK_ROOT, 'docs')): DocsPage[] {
  return GUIDE_PAGES.map((page) => renderPage(page, readFileSync(join(docsDirectory, `${page}.md`), 'utf-8')));
}

/** The whole document, from the pages. The same pages give the same bytes. */
export function buildDocsHtml(pages: DocsPage[] = readPages(), version = sdkVersion()): string {
  const nav = pages.map((p) => `<li><a href="#${p.page}">${escapeHtml(p.title)}</a></li>`).join('\n');
  const sections = pages.map((p) => `<section id="${p.page}">\n${p.html}</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>atrium Connector SDK docs</title>
<style>${STYLES}</style>
</head>
<body>
<header class="bar">
<span class="name">atrium Connector SDK <span class="version">${escapeHtml(version)}</span></span>
<button type="button" id="theme" aria-label="Switch between light and dark">Light / dark</button>
</header>
<div class="layout">
<nav aria-label="Pages"><ol>
${nav}
</ol></nav>
<main>
${sections}
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

export function sdkVersion(): string {
  return (JSON.parse(readFileSync(join(SDK_ROOT, 'package.json'), 'utf-8')) as { version: string }).version;
}

/** The HTML file the package ships, or null in a source checkout that hasn't packed yet. */
export function shippedDocsHtml(): string | null {
  return existsSync(DOCS_HTML_PATH) ? readFileSync(DOCS_HTML_PATH, 'utf-8') : null;
}

// Brand v2: the dark home look follows the system until a person picks one;
// values are the Brand v2 palette's (atrium's atr-ui/tokens.css), copied here
// because the file has to stand alone. Fonts are the brand's fallback stacks:
// the files ship with the apps, not in a package.
const STYLES = `
:root {
  color-scheme: dark;
  --ground: #0E1314; --surface: #141B1C; --raised: #1B2425; --hairline: #263133;
  --text: #E6EDED; --muted: #8E9D9E; --link: #33CCCC; --focus: #73E6E6;
  --sans: 'IBM Plex Sans', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --display: 'Sora', 'Segoe UI', system-ui, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Consolas, Menlo, monospace;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --ground: #F6F8F8; --surface: #FFFFFF; --raised: #EEF2F2; --hairline: #DDE4E4;
    --text: #101718; --muted: #566466; --link: #137B7B; --focus: #137B7B;
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --ground: #F6F8F8; --surface: #FFFFFF; --raised: #EEF2F2; --hairline: #DDE4E4;
  --text: #101718; --muted: #566466; --link: #137B7B; --focus: #137B7B;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 64px; }
body { margin: 0; background: var(--ground); color: var(--text); font: 400 16px/1.6 var(--sans); }
a { color: var(--link); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.bar { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center;
  gap: 16px; padding: 12px 16px; background: var(--surface); border-bottom: 1px solid var(--hairline); }
.name { font-weight: 600; }
.version { color: var(--muted); font: 400 14px var(--mono); margin-left: 8px; }
button { font: 500 14px var(--sans); color: var(--text); background: var(--raised);
  border: 1px solid var(--hairline); border-radius: 4px; padding: 6px 12px; cursor: pointer; }
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 32px; max-width: 1120px; margin: 0 auto; padding: 24px 16px 96px; }
nav { position: sticky; top: 64px; align-self: start; }
nav ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
nav a { display: block; padding: 4px 8px; border-radius: 4px; text-decoration: none; color: var(--text); }
nav a:hover { background: var(--raised); }
main { min-width: 0; max-width: 78ch; }
section { padding-bottom: 48px; margin-bottom: 48px; border-bottom: 1px solid var(--hairline); }
section:last-child { border-bottom: 0; }
h1 { font: 300 32px/1.15 var(--display); letter-spacing: -0.015em; margin: 0 0 16px; }
h2 { font: 600 20px/1.3 var(--sans); margin: 40px 0 8px; }
h3 { font: 600 16px/1.4 var(--sans); margin: 28px 0 8px; }
p, ul, ol { margin: 0 0 16px; }
li { margin-bottom: 4px; }
code { font: 400 0.9em var(--mono); background: var(--raised); border-radius: 4px; padding: 1px 5px; overflow-wrap: anywhere; }
pre { background: var(--surface); border: 1px solid var(--hairline); border-radius: 8px; padding: 12px 16px; overflow-x: auto; margin: 0 0 16px; }
pre code { background: none; padding: 0; font-size: 14px; overflow-wrap: normal; }
.table { overflow-x: auto; margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 15px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--hairline); }
th { color: var(--muted); font-weight: 500; }
blockquote { margin: 0 0 16px; padding: 4px 16px; border-left: 3px solid var(--hairline); color: var(--muted); }
@media (max-width: 800px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  nav { position: static; }
  nav ol { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
}
`;

// The switch: light or dark, remembered where the browser allows it.
const SCRIPT = `
(function () {
  var root = document.documentElement;
  try { var saved = localStorage.getItem('atrium-docs-theme'); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
  document.getElementById('theme').addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') === 'dark' ||
      (!root.getAttribute('data-theme') && !matchMedia('(prefers-color-scheme: light)').matches);
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('atrium-docs-theme', next); } catch (e) {}
  });
})();
`;
