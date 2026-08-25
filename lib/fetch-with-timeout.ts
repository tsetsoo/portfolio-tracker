/**
 * Wraps a fetch implementation so every request it makes is bounded by
 * `AbortSignal.timeout(timeoutMs)`. A request that hangs past the timeout
 * rejects the way any other fetch failure already does — a rejected
 * promise carrying an Error-like value — so callers that already catch and
 * handle a thrown/rejected fetch (falling back to cache, retrying, etc.)
 * keep working unchanged; this does not introduce a new failure shape.
 *
 * Does not touch an `init.signal` the caller already supplied — none of
 * this app's current call sites pass one, but silently overwriting a
 * caller's own abort signal would be a surprising thing for a "just add a
 * timeout" wrapper to do.
 */
export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    })) as typeof fetch;
}
