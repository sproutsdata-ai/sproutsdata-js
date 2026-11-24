/**
 * The names an agent run's effort tiers had before, read as the tiers they named.
 *
 * The API names the tiers `quick`, `basic`, `standard`, `detailed` and `maximum` (plus `auto`),
 * and still reads their earlier names. The spec lists only the new ones, so the SDK reads the
 * earlier names itself and always sends the new name (be `billing/prices.py` `PUBLIC_NAMES`,
 * `agents/schemas.py` `Effort._missing_`).
 */

import type * as W from '../generated/wire.js';
import type { LegacyEffort } from '../types/index.js';

/** Each earlier tier name, and the name the API gives that tier now. */
export const EFFORT_NAMES: Readonly<Record<LegacyEffort, W.Effort>> = {
  minimal: 'quick',
  low: 'basic',
  medium: 'standard',
  high: 'detailed',
  xhigh: 'maximum',
};

function isLegacy(effort: string): effort is LegacyEffort {
  return Object.hasOwn(EFFORT_NAMES, effort);
}

/** `effort` by the tier's current name; any other value (a new name, `auto`) as given. */
export function currentEffort(effort: W.Effort | LegacyEffort): W.Effort {
  return isLegacy(effort) ? EFFORT_NAMES[effort] : effort;
}
