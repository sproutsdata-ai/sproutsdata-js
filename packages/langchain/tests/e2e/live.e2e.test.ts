/** Each tool and the retriever, once through LangChain's entry points, on the real stack. */

import { describe, expect, it } from 'vitest';

import { SproutsDataRetriever, sproutsDataTools } from '../../src/index.js';
import { client, STACK } from './stack.js';

const parse = (content: unknown): Record<string, unknown> => JSON.parse(String(content)) as Record<string, unknown>;

describe.skipIf(STACK === undefined)('the LangChain adapter on the stack', () => {
  it('answers each tool through invoke', async () => {
    const tools = new Map(sproutsDataTools({ client: client() }).map((tool) => [tool.name, tool]));
    const search = parse(await tools.get('sprouts_search')?.invoke({ query: 'robotics', limit: 2 }));
    const similar = parse(await tools.get('sprouts_similar')?.invoke({ anchors: [{ value: 'stripe.com' }] }));
    const lookup = parse(await tools.get('sprouts_entity_lookup')?.invoke({ category: 'person', ids: ['https://www.linkedin.com/in/alex-example-0'] }));
    expect([search['total'] !== undefined, similar['total'] !== undefined, lookup['results'] !== undefined]).toEqual([true, true, true]);
  });

  it.each([['company'], ['auto']] as const)('retrieves documents for a %s search', async (category) => {
    const retriever = new SproutsDataRetriever({ client: client(), category, k: 3 });
    const docs = await retriever.invoke('robotics companies in Germany');
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.length).toBeLessThanOrEqual(3);
    expect(docs.every((doc) => doc.pageContent !== '')).toBe(true);
  });
});
