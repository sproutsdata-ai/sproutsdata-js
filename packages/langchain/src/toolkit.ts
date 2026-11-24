/**
 * `sproutsDataTools`: the Sprouts tools for a LangChain agent, sharing one
 * client.
 *
 * A plain factory rather than a `BaseToolkit` subclass: agents take a list of
 * tools, and a class would add a name to learn and nothing else.
 */

import { type ConnectionOptions, resolveClient, Toolset, type ToolsetOptions } from 'sproutsdata/tools';

import { type SproutsDataTool, TOOL_CLASSES } from './tools.js';

/** The connection, plus the toolset's settings the model cannot change. */
export interface SproutsDataToolsOptions extends ConnectionOptions, ToolsetOptions {}

/**
 * `sprouts_search`, `sprouts_similar` and `sprouts_entity_lookup` (or the
 * ones `include` names) as LangChain tools.
 *
 * Every tool returned shares one client and one `Toolset`. A `client` is used
 * as it is; without one, it is built from the connection settings.
 * `maxResults` runs from 1 to 25 (the default); a model asking for more gets
 * that many, and a caveat.
 *
 * Throws `ClientValidationError` for a missing key, a refused base URL, a
 * connection setting beside a client or an invalid option: here, before any
 * agent runs.
 */
export function sproutsDataTools(options: SproutsDataToolsOptions = {}): SproutsDataTool[] {
  const { client, apiKey, baseUrl, timeoutMs, maxRetries, ...settings } = options;
  const toolset = new Toolset(resolveClient({ client, apiKey, baseUrl, timeoutMs, maxRetries }), settings);
  return toolset.toolNames.map((name) => new TOOL_CLASSES[name]({ toolset }));
}
