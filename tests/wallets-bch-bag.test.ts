import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrate } from "@/lib/db/migrate";
import {
  addBchAddress,
  consolidateBchWallets,
  getOrCreateWallet,
  listAddressesForWallet,
  listWallets,
} from "@/lib/wallets/repo";

const databases: Database.Database[] = [];

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("BCH address bag", () => {
  it("adds multiple BCH addresses under one wallet", () => {
    const db = makeDb();
    const a = "bitcoincash:qqga56448mfwdp6acashjsumx9y6ve5h4c6e6c53vn";
    const b = "bitcoincash:qplt5tkkl9tywexy9ugmu6dsjayhfr5nmcrad2vnwh";

    const first = addBchAddress(db, a, "Cash");
    const second = addBchAddress(db, b);

    expect(second.id).toBe(first.id);
    expect(listWallets(db).filter((w) => w.chain === "bch")).toHaveLength(1);
    expect(listAddressesForWallet(db, first.id).sort()).toEqual([a, b].sort());
    expect(first.label).toBe("Cash");
  });

  it("consolidates separate BCH wallets into one bag", () => {
    const db = makeDb();
    const a = "bitcoincash:qqga56448mfwdp6acashjsumx9y6ve5h4c6e6c53vn";
    const b = "bitcoincash:qplt5tkkl9tywexy9ugmu6dsjayhfr5nmcrad2vnwh";
    // Bypass bag helper to simulate the old one-wallet-per-address rows.
    getOrCreateWallet(db, "bch", a);
    getOrCreateWallet(db, "bch", b);
    expect(listWallets(db).filter((w) => w.chain === "bch")).toHaveLength(2);

    const merged = consolidateBchWallets(db);
    expect(merged).not.toBeNull();
    expect(listWallets(db).filter((w) => w.chain === "bch")).toHaveLength(1);
    expect(listAddressesForWallet(db, merged!.id).sort()).toEqual([a, b].sort());
  });
});
