import { describe, expect, it } from "vitest";

import {
  classifyImportNote,
  summarizeImportNotes,
} from "@/lib/import/notes";

describe("import note classification", () => {
  it("separates rewards, applied disposals, closed positions, and warnings", () => {
    expect(classifyImportNote("Skipped referral_card_cashback")).toBe(
      "skipped",
    );
    expect(classifyImportNote("Applied sell: 0.5 ETH")).toBe("netted");
    expect(classifyImportNote("Applied withdrawal: 1.5 ETH")).toBe("netted");
    expect(classifyImportNote("Closed position: BTC")).toBe("closed");
    expect(
      classifyImportNote("Sell exceeded open quantity for CRO (leftover 1)"),
    ).toBe("warning");
    expect(classifyImportNote("Invalid amount")).toBe("warning");
  });

  it("summarizes counts for the import preview", () => {
    const summary = summarizeImportNotes([
      { line: 2, message: "Skipped referral_card_cashback" },
      { line: 3, message: "Skipped reimbursement" },
      { line: 4, message: "Applied sell: 1 ETH" },
      { line: 5, message: "Applied withdrawal: 0.1 BTC" },
      { line: 0, message: "Closed position: ETH" },
      { line: 6, message: "Sell exceeded open quantity for CRO (leftover 2)" },
    ]);

    expect(summary).toEqual({
      skipped: 2,
      netted: 2,
      closed: 1,
      warnings: 1,
      other: 0,
      total: 6,
    });
  });
});
