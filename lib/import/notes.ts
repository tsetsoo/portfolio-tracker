export type ImportNote = {
  line: number;
  message: string;
};

export type ImportNoteKind =
  | "skipped"
  | "netted"
  | "closed"
  | "warning"
  | "other";

export type ImportNoteSummary = {
  skipped: number;
  netted: number;
  closed: number;
  warnings: number;
  other: number;
  total: number;
};

export function classifyImportNote(message: string): ImportNoteKind {
  const text = message.trim();
  if (/^skipped\b/i.test(text)) return "skipped";
  if (/^applied (sell|withdrawal)\b/i.test(text)) return "netted";
  if (/^closed position\b/i.test(text)) return "closed";
  if (/^sell exceeded\b/i.test(text)) return "warning";
  if (/^(invalid|missing|unrecognized)\b/i.test(text)) return "warning";
  return "other";
}

export function summarizeImportNotes(notes: ImportNote[]): ImportNoteSummary {
  const summary: ImportNoteSummary = {
    skipped: 0,
    netted: 0,
    closed: 0,
    warnings: 0,
    other: 0,
    total: notes.length,
  };

  for (const note of notes) {
    const kind = classifyImportNote(note.message);
    if (kind === "warning") summary.warnings += 1;
    else summary[kind] += 1;
  }

  return summary;
}
