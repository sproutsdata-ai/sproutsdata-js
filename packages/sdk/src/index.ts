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

export { VERSION } from './version.js';
