/**
 * `@sproutsdata.ai/ai-sdk` — the Sprouts tools for the Vercel AI SDK.
 *
 * ```ts
 * import { generateText, stepCountIs } from 'ai';
 * import { raiseSproutsDataErrors, sproutsDataTools } from '@sproutsdata.ai/ai-sdk';
 *
 * const result = await generateText({
 *   model,
 *   tools: sproutsDataTools(), // reads SPROUTSDATA_API_KEY
 *   stopWhen: [stepCountIs(5), raiseSproutsDataErrors],
 *   prompt: 'Find payments companies in Germany.',
 * });
 * ```
 *
 * A thin layer over `sproutsdata/tools`: `sprouts_search`, `sprouts_similar`
 * and `sprouts_entity_lookup`, with the Sprouts MCP server's names, input
 * schemas and result shape. Transport, retries, validation, result shaping
 * and the error policy all live in the `sproutsdata` SDK.
 */

export { raiseSproutsDataErrors } from './raise';
export { sproutsDataTools, type SproutsDataTool, type SproutsDataToolsOptions } from './tools';
export { VERSION } from './version';
