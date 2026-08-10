import { describe, expect, it, vi } from "vitest";
import { fetchFrankfurterRateOnDate } from "@/lib/quotes/fx-frankfurter";

describe("fetchFrankfurterRateOnDate", () => {
  it("requests the dated endpoint and returns the rate", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ rates: { EUR: 0.92 } }), { status: 200 }),
    );
    await expect(
      fetchFrankfurterRateOnDate("USD", "EUR", "2022-04-21", fetchImpl),
    ).resolves.toBe(0.92);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "https://api.frankfurter.app/2022-04-21?from=USD&to=EUR",
    );
  });
});
