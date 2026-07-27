import { describe, expect, it, vi } from "vitest";

import {
  fetchYahooQuote,
  yahooSymbolCandidates,
} from "@/lib/quotes/equity-yahoo";

function yahooResponse(price: number, currency: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      chart: {
        result: [{ meta: { regularMarketPrice: price, currency } }],
        error: null,
      },
    }),
    { status },
  );
}

describe("yahooSymbolCandidates", () => {
  it("prefers European exchange suffixes when EUR is requested", () => {
    expect(yahooSymbolCandidates("GRID", "EUR")).toEqual([
      "GRID.DE",
      "GRID.PA",
      "GRID.AS",
      "GRID.MI",
      "GRID",
    ]);
  });

  it("uses a known UCITS alias before exchange suffixes", () => {
    expect(yahooSymbolCandidates("SMH", "EUR")[0]).toBe("VVSM.DE");
  });

  it("keeps bare US tickers first when USD is preferred", () => {
    expect(yahooSymbolCandidates("AAPL", "USD")).toEqual(["AAPL"]);
  });
});

describe("fetchYahooQuote", () => {
  it("selects the first candidate whose currency matches preferredCurrency", async () => {
    const fetchOrdered = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("GRID.DE")) return yahooResponse(54.47, "EUR");
      if (href.includes("/GRID?")) return yahooResponse(177.4, "USD");
      return new Response("missing", { status: 404 });
    });

    await expect(
      fetchYahooQuote("GRID", fetchOrdered, { preferredCurrency: "EUR" }),
    ).resolves.toEqual({ price: 54.47, currency: "EUR" });

    expect(String(fetchOrdered.mock.calls[0]?.[0])).toContain("GRID.DE");
  });

  it("rejects a bare US quote when a preferred EUR listing cannot be found", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/XYZ?")) return yahooResponse(100, "USD");
      return new Response("missing", { status: 404 });
    });

    await expect(
      fetchYahooQuote("XYZ", fetchImpl, { preferredCurrency: "EUR" }),
    ).rejects.toThrow(/EUR|Yahoo/i);
  });

  it("normalizes GBp pence quotes to GBP pounds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(yahooResponse(9450, "GBp"));

    await expect(fetchYahooQuote("FOO.L", fetchImpl)).resolves.toEqual({
      price: 94.5,
      currency: "GBP",
    });
  });
});
