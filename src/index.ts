export { z } from 'zod';

export {
  defineConnector,
  defineAction,
  runAction,
  type ConnectorDefinition,
  type ActionDefinition,
} from './connector';

export { CURRENT_CONNECTOR_API_VERSION } from './version';

// Re-exported so connector authors can type handler(ctx, input) without a
// separate import from the /client subpath. The main app's execution
// harness should import createAtriumClient from "@atrium/connector-sdk/client"
// directly instead, to stay decoupled from this authoring layer.
export type { AtriumClient, AtriumRequestOptions, AtriumResponse } from './client';
