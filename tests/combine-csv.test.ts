import { describe, expect, it } from "vitest";

import { combineCsvTexts } from "@/lib/import/combine-csv";

describe("combineCsvTexts", () => {
  it("returns a single text unchanged", () => {
    const text = "Date,Amount\n2024-01-01,10\n";
    expect(combineCsvTexts([text])).toBe(text);
  });

  it("returns empty string for no texts", () => {
    expect(combineCsvTexts([])).toBe("");
  });

  it("keeps the first header and appends data rows from all files", () => {
    const a = "Date,Amount\n2024-01-01,10\n2024-01-02,20\n";
    const b = "Date,Amount\n2024-02-01,30\n";
    const c = "Date,Amount\n2024-03-01,40\n2024-03-02,50\n";

    expect(combineCsvTexts([a, b, c])).toBe(
      "Date,Amount\n2024-01-01,10\n2024-01-02,20\n2024-02-01,30\n2024-03-01,40\n2024-03-02,50\n",
    );
  });

  it("skips the first line of subsequent files even when headers differ", () => {
    const a = "Date,Amount\n2024-01-01,10\n";
    const b = "Timestamp,Value\n2024-02-01,30\n";

    expect(combineCsvTexts([a, b])).toBe("Date,Amount\n2024-01-01,10\n2024-02-01,30\n");
  });

  it("strips a BOM from the first file header", () => {
    const a = "\uFEFFDate,Amount\n2024-01-01,10\n";
    const b = "\uFEFFDate,Amount\n2024-02-01,20\n";

    expect(combineCsvTexts([a, b])).toBe("Date,Amount\n2024-01-01,10\n2024-02-01,20\n");
  });

  it("handles CRLF and trailing newlines", () => {
    const a = "Date,Amount\r\n2024-01-01,10\r\n";
    const b = "Date,Amount\r\n2024-02-01,20\r\n";

    expect(combineCsvTexts([a, b])).toBe("Date,Amount\n2024-01-01,10\n2024-02-01,20\n");
  });

  it("ignores empty subsequent files and files with only a header", () => {
    const a = "Date,Amount\n2024-01-01,10\n";
    const empty = "";
    const headerOnly = "Date,Amount\n";

    expect(combineCsvTexts([a, empty, headerOnly])).toBe(
      "Date,Amount\n2024-01-01,10\n",
    );
  });
});
