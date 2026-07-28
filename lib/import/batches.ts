import crypto from "node:crypto";
import type Database from "better-sqlite3";

import type { ImportBroker } from "@/lib/import/batch-names";

export type { ImportBroker } from "@/lib/import/batch-names";
export { suggestImportBatchName } from "@/lib/import/batch-names";

export type ImportBatch = {
  id: string;
  name: string;
  broker: ImportBroker;
  sourceDetail: string | null;
  createdAt: string;
  fileNames: string[];
  lotsInserted: number;
  duplicates: number;
  closedCount: number;
  skippedCount: number;
  symbolsTouched: string[];
  notes: string[];
};

export type CreateImportBatchInput = {
  name: string;
  broker: ImportBroker;
  sourceDetail?: string | null;
  fileNames?: string[];
};

export type ImportBatchSummaryUpdate = {
  lotsInserted?: number;
  duplicates?: number;
  closedCount?: number;
  skippedCount?: number;
  symbolsTouched?: string[];
  notes?: string[];
  fileNames?: string[];
};

type ImportBatchRow = {
  id: string;
  name: string;
  broker: ImportBroker;
  source_detail: string | null;
  created_at: string;
  file_names_json: string;
  lots_inserted: number;
  duplicates: number;
  closed_count: number;
  skipped_count: number;
  symbols_touched_json: string;
  notes_json: string;
};

function parseJsonArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function mapBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    name: row.name,
    broker: row.broker,
    sourceDetail: row.source_detail,
    createdAt: row.created_at,
    fileNames: parseJsonArray(row.file_names_json),
    lotsInserted: row.lots_inserted,
    duplicates: row.duplicates,
    closedCount: row.closed_count,
    skippedCount: row.skipped_count,
    symbolsTouched: parseJsonArray(row.symbols_touched_json),
    notes: parseJsonArray(row.notes_json),
  };
}

export function createImportBatch(
  db: Database.Database,
  input: CreateImportBatchInput,
): ImportBatch {
  const name = input.name.trim();
  if (!name) throw new Error("Import name is required");

  const batch: ImportBatch = {
    id: crypto.randomUUID(),
    name,
    broker: input.broker,
    sourceDetail: input.sourceDetail ?? null,
    createdAt: new Date().toISOString(),
    fileNames: input.fileNames ?? [],
    lotsInserted: 0,
    duplicates: 0,
    closedCount: 0,
    skippedCount: 0,
    symbolsTouched: [],
    notes: [],
  };

  db.prepare(
    `INSERT INTO import_batches (
       id, name, broker, source_detail, created_at,
       file_names_json, lots_inserted, duplicates, closed_count,
       skipped_count, symbols_touched_json, notes_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    batch.id,
    batch.name,
    batch.broker,
    batch.sourceDetail,
    batch.createdAt,
    JSON.stringify(batch.fileNames),
    batch.lotsInserted,
    batch.duplicates,
    batch.closedCount,
    batch.skippedCount,
    JSON.stringify(batch.symbolsTouched),
    JSON.stringify(batch.notes),
  );

  return batch;
}

export function updateImportBatchSummary(
  db: Database.Database,
  id: string,
  summary: ImportBatchSummaryUpdate,
): void {
  const current = db
    .prepare(
      `SELECT id, name, broker, source_detail, created_at,
              file_names_json, lots_inserted, duplicates, closed_count,
              skipped_count, symbols_touched_json, notes_json
       FROM import_batches WHERE id = ?`,
    )
    .get(id) as ImportBatchRow | undefined;
  if (!current) throw new Error(`Import batch not found: ${id}`);

  const mapped = mapBatch(current);
  db.prepare(
    `UPDATE import_batches SET
       file_names_json = ?,
       lots_inserted = ?,
       duplicates = ?,
       closed_count = ?,
       skipped_count = ?,
       symbols_touched_json = ?,
       notes_json = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify(summary.fileNames ?? mapped.fileNames),
    summary.lotsInserted ?? mapped.lotsInserted,
    summary.duplicates ?? mapped.duplicates,
    summary.closedCount ?? mapped.closedCount,
    summary.skippedCount ?? mapped.skippedCount,
    JSON.stringify(summary.symbolsTouched ?? mapped.symbolsTouched),
    JSON.stringify(summary.notes ?? mapped.notes),
    id,
  );
}

export function listImportBatches(db: Database.Database): ImportBatch[] {
  const rows = db
    .prepare(
      `SELECT id, name, broker, source_detail, created_at,
              file_names_json, lots_inserted, duplicates, closed_count,
              skipped_count, symbols_touched_json, notes_json
       FROM import_batches
       ORDER BY created_at DESC, id DESC`,
    )
    .all() as ImportBatchRow[];
  return rows.map(mapBatch);
}

export function renameImportBatch(
  db: Database.Database,
  id: string,
  name: string,
): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Import name is required");
  const result = db
    .prepare("UPDATE import_batches SET name = ? WHERE id = ?")
    .run(trimmed, id);
  if (result.changes === 0) throw new Error(`Import batch not found: ${id}`);
}

export function deleteImportBatchRecord(
  db: Database.Database,
  id: string,
): void {
  db.transaction(() => {
    db.prepare(
      "UPDATE lots SET import_batch_id = NULL WHERE import_batch_id = ?",
    ).run(id);
    const result = db
      .prepare("DELETE FROM import_batches WHERE id = ?")
      .run(id);
    if (result.changes === 0) throw new Error(`Import batch not found: ${id}`);
  })();
}
