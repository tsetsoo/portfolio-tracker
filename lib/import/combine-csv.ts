/**
 * Concatenate one or more CSV texts into a single CSV:
 * keep the first file's header, append data rows from all files
 * (always skip the first line of files after the first).
 */
export function combineCsvTexts(texts: string[]): string {
  if (texts.length === 0) return "";

  const allLines: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const lines = splitCsvLines(stripBom(texts[i] ?? ""));
    if (lines.length === 0) continue;

    if (i === 0) {
      allLines.push(...lines);
    } else {
      // Skip header (first line) of subsequent files.
      allLines.push(...lines.slice(1));
    }
  }

  if (allLines.length === 0) return "";
  return `${allLines.join("\n")}\n`;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitCsvLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line, index, arr) => {
    // Drop a single trailing empty line from a final newline; keep blank mid-file rows.
    if (line === "" && index === arr.length - 1) return false;
    return true;
  });
}
