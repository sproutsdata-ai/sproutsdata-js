/**
 * The JavaScript and TypeScript client for the Sprouts Data API.
 *
 * Layers, from the outside in (each imports only those after it; `npm run lint:layers`
 * checks it): `tools` (the API as tools a model can call, on the public surface only),
 * `client.ts` (wiring), `resources` (one file per API feature), `requests` (request
 * bodies and the checks the server would otherwise refuse), `core` (transport, retries,
 * pagination, server-sent events, errors), `types` (the public names) and `generated`
 * (everything derived from the shared spec).
 *
 * @packageDocumentation
 */

export { SproutsData } from './client.js';
export {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  ClientValidationError,
  ConcurrencyLimitError,
  ConflictError,
  CreditsRefusedError,
  CursorExpiredError,
  CursorInvalidError,
  ExportFailedError,
  FeatureNotAvailableError,
  GatewayError,
  InsufficientCreditsError,
  InternalServerError,
  InvalidRequestError,
  ListNameTakenError,
  NotFoundError,
  OrgChartCompanyAmbiguousError,
  PaginationDepthExceededError,
  PermissionDeniedError,
  RateLimitError,
  RedirectRefusedError,
  ResultsExpiredError,
  ServiceUnavailableError,
  SproutsDataError,
  UpstreamTimeoutError,
  WaitTimeoutError,
  WalletFrozenError,
  WorkspaceRequiredError,
} from './core/errors.js';
export type { CompanyCandidate, FieldError } from './core/errors.js';
export type { ClientOptions } from './core/options.js';
export type { AnyRecord, RecordTypes } from './core/records.js';
export type { ServerSentEvent } from './core/sse.js';
export type { RequestOptions } from './core/transport.js';
export type { AnswerMeta } from './core/answer.js';
export { canAfford, entityHit, lookupRef, missingValues, recordsOf, totalFor } from './resources/helpers.js';
export type * from './types/index.js';
export { VERSION } from './version.js';
