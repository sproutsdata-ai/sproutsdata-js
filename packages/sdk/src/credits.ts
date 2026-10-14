/**
 * The credit surface (`client.credits`): the tenant's balance and the calling
 * key's own spend. Both routes are free and require `dsp.usage.read`.
 *
 * Distinct from `client.history`, which is the record of individual runs.
 */

import type { RequestOptions } from './http';
import { APIResource } from './resource';
import type { CreditsResponse, UsageParams, UsageResponse } from './types';
import { toIso } from './validate';

export class Credits extends APIResource {
  /** `GET /v1/credits` — the tenant's credit balance on this platform. */
  async retrieve(options?: RequestOptions): Promise<CreditsResponse> {
    return this.transport.request('GET', '/v1/credits', { options });
  }

  /**
   * `GET /v1/keys/usage` — spend for the calling key (the one this client is
   * configured with); other keys' usage is not readable.
   *
   * Defaults on the server: the last 30 days, bucketed by day.
   */
  async usage(params: UsageParams = {}, options?: RequestOptions): Promise<UsageResponse> {
    const query = {
      granularity: params.granularity,
      from: params.from === undefined ? undefined : toIso(params.from, 'from'),
      to: params.to === undefined ? undefined : toIso(params.to, 'to'),
    };
    return this.transport.request('GET', '/v1/keys/usage', { query, options });
  }
}
