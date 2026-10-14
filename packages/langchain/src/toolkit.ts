/**
 * `sproutsDataTools` — the Sprouts tools for a LangChain agent, sharing one
 * client.
 *
 * A plain factory rather than a `BaseToolkit` subclass: agents take a list of
 * tools, and a class would add a name to learn and nothing else.
 */

import { Toolset, type ToolsetOptions } from 'sproutsdata/tools';

import { connect, type SproutsDataConnection } from './connection';
import { TOOL_CLASSES, type SproutsDataTool } from './tools';
import { INTEGRATION } from './version';

/** The connection, plus the toolset's settings the model cannot change. */
export interface SproutsDataToolsOptions extends SproutsDataConnection, Omit<ToolsetOptions, 'integration'> {}

/**
 * `sprouts_search`, `sprouts_similar` and `sprouts_entity_lookup` (or the
 * ones `include` names) as LangChain tools.
 *
 * Every tool returned shares one client and one `Toolset`, and calls send
 * `X-SproutsData-Client: langchain/<version>`. `maxResults` runs from 1 to
 * 25 (the default); a model asking for more gets that many, and a caveat.
 *
 * Throws `ClientValidationError` for a missing key, a refused base URL or an
 * invalid option — here, before any agent runs.
 */
export function sproutsDataTools(options: SproutsDataToolsOptions = {}): SproutsDataTool[] {
  const { client, apiKey, baseUrl, timeoutMs, maxRetries, ...settings } = options;
  const toolset = new Toolset(connect({ client, apiKey, baseUrl, timeoutMs, maxRetries }), {
    ...settings,
    integration: INTEGRATION,
  });
  return toolset.toolNames.map((name) => new TOOL_CLASSES[name]({ toolset }));
}
