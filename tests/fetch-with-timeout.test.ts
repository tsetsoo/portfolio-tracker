import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests an AbortSignal.timeout at the given duration and passes it through", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const wrapped = fetchWithTimeout(fetchImpl, 10_000);
    await wrapped("https://example.test/quote");

    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it("preserves other init fields already passed by the caller", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const wrapped = fetchWithTimeout(fetchImpl, 5_000);

    await wrapped("https://example.test/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe("{}");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not override a signal the caller already supplied", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const wrapped = fetchWithTimeout(fetchImpl, 5_000);
    const ownController = new AbortController();

    await wrapped("https://example.test/quote", { signal: ownController.signal });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.signal).toBe(ownController.signal);
  });

  it("surfaces a timed-out request as an ordinary rejected fetch, not a new failure shape", async () => {
    // Simulate what a real timeout does — fetchImpl rejects because the
    // signal it was handed aborted — without waiting out a real timer.
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
      return controller.signal;
    });

    const wrapped = fetchWithTimeout(fetchImpl, 1);

    await expect(wrapped("https://example.test/quote")).rejects.toBeInstanceOf(
      Error,
    );
  });
});
