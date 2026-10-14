/**
 * The `/v1/members` surface (`client.members`): whether one email belongs to
 * a member of the credential's own organisation.
 *
 * For integrations that must attribute work to a person before spending the
 * organisation's credits. One email per call, never a roster. Free; requires
 * `dsp.search.read` or `dsp.agents.write`.
 */

import type { RequestOptions } from './http';
import { APIResource } from './resource';
import type { ResponseMeta } from './types';
import { ensure } from './validate';

/**
 * - `active` — has a role and has activated the platform.
 * - `not_activated` — has a role but has not passed the consent screen yet.
 * - `invitation_pending` — has not accepted their invitation.
 * - `no_access` — in the organisation, with no role on this platform.
 * - `unknown` — not a member (`found: false`).
 *
 * Open: a state the server adds later is still delivered.
 */
export type MemberState =
  | 'active'
  | 'not_activated'
  | 'invitation_pending'
  | 'no_access'
  | 'unknown'
  | (string & {});

/** Response of `POST /v1/members/resolve`. */
export interface MemberResolveResponse {
  /**
   * True when the email belongs to a member of the credential's
   * organisation. **False is an answer, not an error**: "not a member" is a
   * 200, and every non-2xx means "could not determine" — never treat an
   * error as `found: false`.
   */
  found: boolean;
  /** Null when not found. */
  user_id: number | null;
  /** Normalised (trimmed, lower-cased) when not found; as stored when found. */
  email: string;
  /** Their role on this platform, or null if they have none. */
  role: string | null;
  state: MemberState;
  meta: ResponseMeta;
}

export class Members extends APIResource {
  /**
   * Resolve one email to a member of the credential's organisation. Matched
   * case-insensitively; the organisation is always the credential's own.
   */
  async resolve(email: string, options?: RequestOptions): Promise<MemberResolveResponse> {
    ensure(
      typeof email === 'string' && email.trim().length > 0,
      '`email` must be a non-empty string',
    );
    return this.transport.request('POST', '/v1/members/resolve', {
      body: { email },
      routeClass: 'safe',
      options,
    });
  }
}
