import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { acquirePassLock, releasePassLock } from "@/lib/alerts/pass-lock";
import { migrate } from "@/lib/db/migrate";

const NOW = new Date("2026-08-21T12:00:00.000Z");

describe("acquirePassLock / releasePassLock", () => {
  describe("single connection", () => {
    let db: Database.Database;

    afterEach(() => {
      db.close();
    });

    it("fails a second acquire while the lease is still held", () => {
      db = new Database(":memory:");
      migrate(db);

      expect(acquirePassLock(db, NOW, 60_000)).toBe(true);
      expect(acquirePassLock(db, new Date(NOW.getTime() + 1_000), 60_000)).toBe(
        false,
      );
    });

    it("succeeds again once the lease has been released", () => {
      db = new Database(":memory:");
      migrate(db);

      expect(acquirePassLock(db, NOW, 60_000)).toBe(true);
      releasePassLock(db);
      expect(acquirePassLock(db, new Date(NOW.getTime() + 1_000), 60_000)).toBe(
        true,
      );
    });

    it("succeeds again once the lease has expired, without an explicit release", () => {
      db = new Database(":memory:");
      migrate(db);

      expect(acquirePassLock(db, NOW, 60_000)).toBe(true);
      // Exactly at expiry the old lease is not yet "in the past" relative to
      // itself, so probe just past it.
      const afterExpiry = new Date(NOW.getTime() + 60_000 + 1);
      expect(acquirePassLock(db, afterExpiry, 60_000)).toBe(true);
    });
  });

  describe("two connections to the same database file", () => {
    // This is the case the old module-level `inFlightPass` promise could
    // never see: Next's webpack layers give the app several independent
    // module instances of lib/alerts/run.ts, each holding its own copy of
    // any in-process flag. Two real better-sqlite3 connections opened on
    // one file reproduce that condition; two `:memory:` databases would
    // not, since each is its own private, unshared database.
    const tmpFiles: string[] = [];

    afterEach(() => {
      for (const file of tmpFiles) fs.rmSync(file, { force: true });
    });

    it("lets only one connection win the lock", () => {
      const file = path.join(os.tmpdir(), `pt-pass-lock-${Date.now()}.db`);
      tmpFiles.push(file);

      const dbA = new Database(file);
      migrate(dbA);
      const dbB = new Database(file);

      try {
        expect(acquirePassLock(dbA, NOW, 60_000)).toBe(true);
        // dbB is a separate connection to the same file: it must see the
        // lock dbA just claimed, and lose the race.
        expect(acquirePassLock(dbB, new Date(NOW.getTime() + 1_000), 60_000)).toBe(
          false,
        );

        releasePassLock(dbA);
        // Freed by dbA, dbB can now claim it.
        expect(acquirePassLock(dbB, new Date(NOW.getTime() + 2_000), 60_000)).toBe(
          true,
        );
      } finally {
        dbA.close();
        dbB.close();
      }
    });
  });
});
