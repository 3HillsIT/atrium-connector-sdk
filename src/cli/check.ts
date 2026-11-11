// `atrium-connector check`: builds and self-checks, writes and signs nothing.

import { bundleContractLine, checkConnector } from '../build';
import { parseCommandArgs, plural, refusedFailures, ui } from './io';
import type { Command } from './io';

export const check: Command = {
  usage: 'check',
  summary: 'Builds the Connector and self-checks it. Writes and signs nothing.',
  async run(args, io) {
    if (!parseCommandArgs(check, args, {}, io)) return 2;

    const out = ui(io);
    out.step('Building the Connector and checking it as an Instance would');
    const report = await checkConnector(io.cwd, { publishedAt: io.now().toISOString() });
    if (report.connectorApiVersion !== undefined) out.text(bundleContractLine(report.connectorApiVersion));

    if (report.failures.length > 0) return refusedFailures('check', report.failures, io);
    const { manifest } = report.built!;
    out.success(
      `check passed: ${manifest.id} ${manifest.version}, ` +
        `${plural(manifest.actions.length, 'action', 'actions')}. Nothing was written or signed.`,
    );
    return 0;
  },
};
