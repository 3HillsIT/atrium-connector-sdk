// `atrium-connector docs`: opens the SDK's docs in the browser, as the one
// HTML file the package ships. A source checkout has no such file until
// `prepack` writes it, so the command builds one into a temp folder instead.

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DOCS_HTML_FILE, DOCS_HTML_PATH, buildDocsHtml, shippedDocsHtml } from './docs-html';
import { parseCommandArgs, ui } from './io';
import type { Command } from './io';
import { follow } from './output';

export const docs: Command = {
  usage: 'docs [--print]',
  summary: 'Opens the docs in your browser. --print only prints where the file is.',
  async run(args, io) {
    const parsed = parseCommandArgs(docs, args, { print: { type: 'boolean' } }, io);
    if (!parsed) return 2;
    const out = ui(io);

    let path = DOCS_HTML_PATH;
    if (shippedDocsHtml() === null) {
      path = join(mkdtempSync(join(tmpdir(), 'atrium-connector-docs-')), DOCS_HTML_FILE);
      writeFileSync(path, buildDocsHtml());
    }

    if (parsed.values.print === true || !io.open) {
      out.text(['The docs are in one file: ', follow(path)]);
      return 0;
    }
    out.step('Opening the docs in your browser');
    if (await io.open(path)) {
      out.success(['Opened ', follow(path)]);
      return 0;
    }
    // Not an error: a machine with no browser (a server, a container) still gets the file's place.
    out.warning(['No browser opened. The docs are in one file you can open yourself: ', follow(path)]);
    return 0;
  },
};
