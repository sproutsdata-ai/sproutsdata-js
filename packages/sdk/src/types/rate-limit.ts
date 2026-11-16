/** The rate limit the server counted a call against, when it said. */
export interface RateLimitInfo {
  readonly limit: number | undefined;
  readonly remaining: number | undefined;
  /** Seconds until the window resets. */
  readonly resetSeconds: number | undefined;
}
