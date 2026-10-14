/**
 * `raiseSproutsDataErrors` — make a rejected key, a missing scope or an empty
 * credit balance reject `generateText` / `streamText`.
 *
 * Contract 02 §12.3: what only the application can fix is raised to the
 * application, not handed to the model. A Sprouts tool throws those errors,
 * but the AI SDK catches whatever a tool's `execute` throws and sends it to
 * the model as a `tool-error` — which then apologises, retries, or invents an
 * answer. A stop condition runs after each step's tools and before the next
 * model call, and the AI SDK lets what it throws propagate; so this one
 * rethrows the SDK's own error, and the model never sees it.
 *
 * Errors are matched by name, not `instanceof`, so a client from a second
 * copy of `sproutsdata` is covered too.
 */

/** The errors only the application can act on: 401, 403 and 402. */
const RAISED: ReadonlySet<string> = new Set([
  'AuthenticationError',
  'PermissionDeniedError',
  'InsufficientCreditsError',
]);

/** The part of an AI SDK step this condition reads. */
interface Step {
  readonly content: ReadonlyArray<unknown>;
}

/**
 * A stop condition that never stops a run: it throws the
 * `AuthenticationError`, `PermissionDeniedError` or
 * `InsufficientCreditsError` a Sprouts tool raised in the last step.
 *
 * ```ts
 * stopWhen: [stepCountIs(5), raiseSproutsDataErrors]
 * ```
 */
export function raiseSproutsDataErrors({ steps }: { steps: ReadonlyArray<Step> }): boolean {
  for (const part of steps.at(-1)?.content ?? []) {
    const { type, error } = part as { type?: unknown; error?: unknown };
    if (type === 'tool-error' && error instanceof Error && RAISED.has(error.name)) throw error;
  }
  return false;
}
