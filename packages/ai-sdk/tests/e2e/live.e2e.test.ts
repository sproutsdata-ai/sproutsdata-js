/** Each tool once through the AI SDK's `tool().execute`, on the real stack. */

import { describe, expect, it } from 'vitest';

import { sproutsDataTools } from '../../src/index.js';
import { client, STACK } from './stack.js';

const options = { toolCallId: 'call_1', messages: [], context: {} };

describe.skipIf(STACK === undefined)('the AI SDK adapter on the stack', () => {
  it('answers each tool through execute', async () => {
    const tools = sproutsDataTools({ client: client() });
    const search = await tools['sprouts_search']?.execute?.({ query: 'robotics', limit: 2 }, options);
    const similar = await tools['sprouts_similar']?.execute?.({ anchors: [{ value: 'stripe.com' }] }, options);
    const lookup = await tools['sprouts_entity_lookup']?.execute?.({ category: 'company', ids: ['example-0.de'] }, options);
    expect(search).toHaveProperty('total');
    expect(similar).toHaveProperty('total');
    expect(lookup).toHaveProperty('results');
  });
});
