import { describe, expect, it, vi } from "vitest";

import {
  deriveBtcAddress,
  deriveBtcAddressWindow,
  parseBtcXpub,
  resolveBtcScriptType,
  toStandardXpub,
} from "@/lib/wallets/xpub";

/** BIP-84 test vector account zpub (abandon…about / m/84'/0'/0'). */
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

/** Same account key as ZPUB, re-encoded with classic xpub version bytes. */
const XPUB_FROM_ZPUB = toStandardXpub(ZPUB);

describe("xpub derivation", () => {
  it("derives BIP-84 native segwit receive addresses from zpub", () => {
    expect(deriveBtcAddress(ZPUB, false, 0).address).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    expect(deriveBtcAddress(ZPUB, false, 1).address).toBe(
      "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
    );
    expect(deriveBtcAddress(ZPUB, true, 0).address).toBe(
      "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
    );
  });

  it("parses zpub and seeds a receive+change window", () => {
    const parsed = parseBtcXpub(ZPUB);
    expect(parsed.scriptType).toBe("p2wpkh");
    expect(parsed.firstReceive).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );

    const window = deriveBtcAddressWindow(ZPUB, { gapLimit: 5 });
    const receive = window.filter((row) => !row.isChange);
    const change = window.filter((row) => row.isChange);
    expect(receive).toHaveLength(5);
    expect(change).toHaveLength(5);
  });

  it("extends past the gap when earlier indexes are used", () => {
    const used = new Set([
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", // 0/0
      "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", // 0/1
    ]);
    const window = deriveBtcAddressWindow(ZPUB, {
      gapLimit: 3,
      usedAddresses: used,
    });
    const receiveIndexes = window
      .filter((row) => !row.isChange)
      .map((row) => row.index);
    // used resets gap at 0 and 1, then 3 unused (2,3,4) → indexes 0..4
    expect(Math.max(...receiveIndexes)).toBeGreaterThanOrEqual(4);
  });

  it("lets an xpub override force native segwit (Ledger often exports xpub)", () => {
    const parsed = parseBtcXpub(XPUB_FROM_ZPUB, { scriptType: "p2wpkh" });
    expect(parsed.scriptType).toBe("p2wpkh");
    expect(parsed.firstReceive).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
  });

  it("auto-detects p2wpkh for ambiguous xpub when that 0/0 has history", async () => {
    const native = deriveBtcAddress(XPUB_FROM_ZPUB, false, 0, "p2wpkh").address;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = url.includes(native);
      return new Response(
        JSON.stringify({
          chain_stats: { tx_count: hit ? 2 : 0 },
        }),
        { status: 200 },
      );
    });

    await expect(
      resolveBtcScriptType(XPUB_FROM_ZPUB, { fetchImpl }),
    ).resolves.toBe("p2wpkh");
  });
});
