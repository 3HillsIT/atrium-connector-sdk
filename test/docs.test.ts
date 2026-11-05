import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { GUIDE_PAGES, RULES, guidePagePath } from '../src/build';

// The developer guide in docs/: every page a command's refusal names is there
// and talks about the rule that sent the reader, it ships in the package, and
// its links lead somewhere. A refusal pointing at a page that doesn't exist,
// or at one that never mentions the rule, leaves a developer (or their coding
// agent) guessing, which is what naming the page was for.

const ROOT = resolve(import.meta.dir, '..');
const DOCS = join(ROOT, 'docs');
const pagePath = (page: string) => join(DOCS, `${page}.md`);
const read = (path: string) => readFileSync(path, 'utf-8');
const packageJson = JSON.parse(read(join(ROOT, 'package.json'))) as { name: string; files: string[] };

/** README.md and every page in docs/. */
const DOCUMENTS = [join(ROOT, 'README.md'), ...readdirSync(DOCS).map((name) => join(DOCS, name))];

describe('the pages the commands name', () => {
  test('every guide page exists, and docs/ holds no page the list lacks', () => {
    for (const page of GUIDE_PAGES) expect(existsSync(pagePath(page))).toBe(true);
    expect(readdirSync(DOCS).sort()).toEqual(GUIDE_PAGES.map((page) => `${page}.md`).sort());
  });

  test("every rule's page exists and names the rule", () => {
    for (const [rule, { page }] of Object.entries(RULES)) {
      expect(existsSync(pagePath(page))).toBe(true);
      expect({ rule, mentioned: read(pagePath(page)).includes(rule) }).toEqual({ rule, mentioned: true });
    }
  });

  test('the path a refusal prints is where the package installs the page', () => {
    expect(guidePagePath('rules')).toBe(`node_modules/${packageJson.name}/docs/rules.md`);
  });

  test('the package ships docs/', () => {
    expect(packageJson.files).toContain('docs');
  });
});

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');
  for (const [, heading] of withoutCode.matchAll(/^#{1,6} +(.+?) *$/gm)) {
    const slug = heading!
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

describe('the links', () => {
  test('every relative link reaches a file, and every anchor a heading', () => {
    const broken: string[] = [];
    for (const document of DOCUMENTS) {
      const text = read(document).replace(/```[\s\S]*?```/g, '');
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^[a-z]+:/i.test(target!)) continue;
        const [file, anchor] = target!.split('#') as [string, string | undefined];
        const path = file === '' ? document : resolve(dirname(document), file);
        if (!existsSync(path)) {
          broken.push(`${document}: ${target} (no file)`);
        } else if (anchor !== undefined && !anchorsOf(read(path)).has(anchor)) {
          broken.push(`${document}: ${target} (no heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('written for a developer outside 3HillsIT', () => {
  test("nothing of 3HillsIT's own release steps", () => {
    for (const document of DOCUMENTS) {
      const text = read(document);
      for (const internal of ['Publish Ledger', 'atrium-prod', 'release mode', 'publish:connector', 'Vendira', 'ADITO']) {
        expect({ document, internal, found: text.includes(internal) }).toEqual({ document, internal, found: false });
      }
    }
  });

  test('atrium is lowercase, and no dash stands in for punctuation', () => {
    for (const document of DOCUMENTS) {
      const text = read(document);
      expect({ document, capitalised: text.match(/\bAtrium\b/g) }).toEqual({ document, capitalised: null });
      expect({ document, dash: text.includes('—') }).toEqual({ document, dash: false });
    }
  });
});
