import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { GUIDE_PAGES } from '../src/build';
import { DOCS_HTML_FILE, DOCS_HTML_PATH, NAV_GROUPS, buildDocsHtml, readPages } from '../src/cli/docs-html';
import { runCommand } from './support/connector-repo';

// The docs as one HTML file: it holds every page of docs/*.md, its links
// between pages lead to a place in it, it stands alone, and the file the
// package ships (written by `prepack`) is what the Markdown gives today.

const ROOT = resolve(import.meta.dir, '..');
const html = buildDocsHtml();
const pages = readPages();
/** The document's text: its tags gone, so a heading with a code span in it reads as one string. */
const text = html.replace(/<[^>]+>/g, '');

describe('the docs as one HTML file', () => {
  test('holds every page, in the guide order, each with its title and every heading', () => {
    const order = [...html.matchAll(/<section id="([a-z-]+)">/g)].map((m) => m[1]);
    expect(order).toEqual([...GUIDE_PAGES]);
    for (const page of GUIDE_PAGES) {
      const markdown = readFileSync(join(ROOT, 'docs', `${page}.md`), 'utf-8');
      const headings = [...markdown.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,6} +(.+?) *$/gm)];
      expect(headings.length).toBeGreaterThan(0);
      for (const [, heading] of headings) {
        // The heading's words are in the page, rendered (code spans and links lose their marks).
        const words = heading!.replace(/[`*_]|\]\([^)]*\)|\[/g, '');
        expect({ page, heading, present: text.includes(escape(words)) }).toEqual({ page, heading, present: true });
      }
    }
  });

  test('every link between pages is a jump mark to a place that is in it', () => {
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const marks = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
    expect(marks.length).toBeGreaterThan(GUIDE_PAGES.length);
    for (const mark of marks) expect({ mark, found: ids.has(mark) }).toEqual({ mark, found: true });
    expect(html).not.toMatch(/href="[a-z-]+\.md/);
  });

  test('the list on the left puts every page in exactly one group, and the page says where to start', () => {
    const listed = NAV_GROUPS.flatMap((group) => group.pages.map((p) => p.page));
    expect([...listed].sort()).toEqual([...GUIDE_PAGES].sort());
    expect(NAV_GROUPS[0]!.pages[0]!.page).toBe('tutorial');
    expect(html).toContain('<h1>How to use these docs</h1>');
    expect(html).toContain('Read the first page');
  });

  test('ids are unique, so two pages with one heading never clash', () => {
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('stands alone: no external script, style, font or image, and both themes', () => {
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    expect(html).not.toContain('@import');
    expect(html).toContain('prefers-color-scheme: light');
    expect(html).toContain('data-theme="light"');
  });

  test('is the same bytes for the same pages', () => {
    expect(buildDocsHtml(pages)).toBe(html);
  });

  test('the package ships it, and what prepack wrote matches the Markdown', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      files: string[];
      scripts: Record<string, string>;
    };
    expect(packageJson.files).toContain(DOCS_HTML_FILE);
    expect(packageJson.scripts.prepack).toBe('bun scripts/build-docs.ts');
    // Written when the package is packed: a source checkout may not have it yet.
    if (existsSync(DOCS_HTML_PATH)) expect(readFileSync(DOCS_HTML_PATH, 'utf-8')).toBe(html);
  });
});

describe('atrium-connector docs', () => {
  test('--print says where the file is and opens nothing', async () => {
    const run = await runCommand(ROOT, 'docs', '--print');
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    const path = /The docs are in one file: (.+)\n/.exec(run.stdout)?.[1];
    expect(path).toMatch(new RegExp(`${DOCS_HTML_FILE}$`));
    expect(readFileSync(path!, 'utf-8')).toBe(html);
  });

  test('an unknown option is a usage error', async () => {
    const run = await runCommand(ROOT, 'docs', '--pdf');
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('usage: atrium-connector docs [--print]');
  });
});

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
