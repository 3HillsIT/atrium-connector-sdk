// Writes atrium-connector-docs.html from docs/*.md: `prepack` runs it, so
// every packed or published package carries the docs in one file.
import { writeFileSync } from 'fs';
import { DOCS_HTML_PATH, buildDocsHtml } from '../src/cli/docs-html';

writeFileSync(DOCS_HTML_PATH, buildDocsHtml());
console.log(`Wrote ${DOCS_HTML_PATH}`);
