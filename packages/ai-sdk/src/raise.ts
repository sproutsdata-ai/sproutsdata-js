/**
 * `raiseSproutsDataErrors`: make a rejected key, a missing scope or an empty credit balance
 * reject `generateText` / `streamText`.
 *
 * What only the application can fix is raised to the application, not handed to the model. A
 * Sprouts tool throws those errors, but the AI SDK catches whatever a tool's `execute` throws
 * and sends it to the model as a `tool-error`, which then apologises, retries, or invents an
 * answer. A stop condition runs after each step's tools and before the next model call, and
 * the AI SDK lets what it throws propagate; so this one rethrows the SDK's own error, and the
 * model never sees it.
 *
 * The errors are recognised by `sproutsdata/tools`' own check (`isApplicationError`, by class
 * name along the prototype chain), so a client from a second copy of `sproutsdata` is covered.
 */

import { isApplicationError } from 'sproutsdata/tools';

/** The part of an AI SDK step this condition reads. */
interface Step {
  readonly content: readonly unknown[];
}

/**
 * A stop condition that never stops a run: it throws the `AuthenticationError`,
 * `PermissionDeniedError` or `InsufficientCreditsError` a Sprouts tool raised in the last step.
 *
 * ```ts
 * stopWhen: [stepCountIs(5), raiseSproutsDataErrors]
 * ```
 */
export function raiseSproutsDataErrors({ steps }: { readonly steps: readonly Step[] }): boolean {
  for (const part of steps.at(-1)?.content ?? []) {
    if (part === null || typeof part !== 'object') continue;
    const error: unknown = Reflect.get(part, 'error');
    if (Reflect.get(part, 'type') === 'tool-error' && isApplicationError(error)) throw error;
  }
  return false;
}
