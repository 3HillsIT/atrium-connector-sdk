// `atrium-connector check`: builds and self-checks, writes and signs nothing.

import { bundleContractLine, checkConnector } from '../build';
import { parseCommandArgs, plural, printFailures } from './io';
import type { Command } from './io';

export const check: Command = {
  usage: 'check',
  summary: 'Builds the Connector and self-checks it. Writes and signs nothing.',
  async run(args, io) {
    if (!parseCommandArgs(check, args, {}, io)) return 2;

    const report = await checkConnector(io.cwd, { publishedAt: io.now().toISOString() });
    if (report.connectorApiVersion !== undefined) io.out(bundleContractLine(report.connectorApiVersion));

    if (report.failures.length > 0) {
      printFailures(report.failures, io);
      io.err(`check failed: ${plural(report.failures.length, 'problem', 'problems')}. Nothing was written or signed.`);
      return 1;
    }
    const { manifest } = report.built!;
    io.out(
      `check passed: ${manifest.id} ${manifest.version}, ` +
        `${plural(manifest.actions.length, 'action', 'actions')}. Nothing was written or signed.`,
    );
    return 0;
  },
};
