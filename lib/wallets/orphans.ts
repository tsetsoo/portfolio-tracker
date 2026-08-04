import type Database from "better-sqlite3";

import {
  guessExchangeVenue,
  orphanSearchHint,
} from "@/lib/wallets/exchange-senders";
import {
  listAddressesForWallet,
  listKnownTransferTxHashes,
  listWallets,
} from "@/lib/wallets/repo";
import type { OrphanInflow, WalletChain } from "@/lib/wallets/types";

type EthTxListRow = {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  timeStamp?: string;
  isError?: string;
};

type MempoolVin = {
  prevout?: { scriptpubkey_address?: string };
};

type MempoolVout = {
  scriptpubkey_address?: string;
  value?: number;
};

type MempoolTx = {
  txid?: string;
  status?: { block_time?: number };
  vin?: MempoolVin[];
  vout?: MempoolVout[];
};

const BLOCKSCOUT =
  "https://eth.blockscout.com/api?module=account&action=txlist&sort=desc";
const MEMPOOL = "https://mempool.space/api";

function dayFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

async function fetchEthInflows(
  address: string,
  fetchImpl: typeof fetch,
): Promise<OrphanInflow[]> {
  const url = `${BLOCKSCOUT}&address=${encodeURIComponent(address)}&page=1&offset=40`;
  const response = await fetchImpl(url);
  if (!response.ok) return [];
  const body = (await response.json()) as {
    status?: string;
    result?: EthTxListRow[] | string;
  };
  if (!Array.isArray(body.result)) return [];

  const out: OrphanInflow[] = [];
  for (const row of body.result) {
    if (!row.hash || !row.to || row.isError === "1") continue;
    if (row.to.toLowerCase() !== address.toLowerCase()) continue;
    const wei = BigInt(row.value ?? "0");
    if (wei <= BigInt(0)) continue;
    const amount = Number(wei) / 1e18;
    const ts = Number(row.timeStamp ?? 0);
    const transferredAt = ts > 0 ? dayFromUnix(ts) : "unknown";
    const fromAddress = row.from?.toLowerCase() ?? null;
    const venue = guessExchangeVenue("eth", fromAddress);
    out.push({
      chain: "eth",
      asset: "ETH",
      amount,
      txHash: row.hash.toLowerCase(),
      transferredAt,
      toAddress: address.toLowerCase(),
      fromAddress,
      guessedVenue: venue,
      searchHint: orphanSearchHint({
        venue,
        asset: "ETH",
        amount,
        transferredAt,
      }),
    });
  }
  return out;
}

async function fetchBtcInflows(
  address: string,
  fetchImpl: typeof fetch,
): Promise<OrphanInflow[]> {
  const response = await fetchImpl(
    `${MEMPOOL}/address/${encodeURIComponent(address)}/txs`,
  );
  if (!response.ok) return [];
  const txs = (await response.json()) as MempoolTx[];
  const out: OrphanInflow[] = [];

  for (const tx of txs.slice(0, 40)) {
    if (!tx.txid) continue;
    const paid = (tx.vout ?? []).filter(
      (vout) => vout.scriptpubkey_address === address && (vout.value ?? 0) > 0,
    );
    if (paid.length === 0) continue;

    const amount = paid.reduce((sum, vout) => sum + (vout.value ?? 0), 0) / 1e8;
    const senders = (tx.vin ?? [])
      .map((vin) => vin.prevout?.scriptpubkey_address)
      .filter((value): value is string => Boolean(value))
      .filter((value) => value !== address);
    // Skip self-churn (only our addresses as inputs).
    if (senders.length === 0) continue;

    const fromAddress = senders[0] ?? null;
    const transferredAt = tx.status?.block_time
      ? dayFromUnix(tx.status.block_time)
      : "unknown";
    const venue = guessExchangeVenue("btc", fromAddress);
    out.push({
      chain: "btc",
      asset: "BTC",
      amount,
      txHash: tx.txid.toLowerCase(),
      transferredAt,
      toAddress: address,
      fromAddress,
      guessedVenue: venue,
      searchHint: orphanSearchHint({
        venue,
        asset: "BTC",
        amount,
        transferredAt,
      }),
    });
  }
  return out;
}

export async function findOrphanInflows(
  db: Database.Database,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<OrphanInflow[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const known = listKnownTransferTxHashes(db);
  const wallets = listWallets(db);
  const found: OrphanInflow[] = [];

  for (const wallet of wallets) {
    const addresses =
      wallet.chain === "btc" || wallet.chain === "bch"
        ? listAddressesForWallet(db, wallet.id)
        : [wallet.address];

    for (const address of addresses) {
      try {
        if (wallet.chain === "eth") {
          found.push(...(await fetchEthInflows(address, fetchImpl)));
        } else if (wallet.chain === "btc") {
          found.push(...(await fetchBtcInflows(address, fetchImpl)));
        }
      } catch {
        // Best-effort; skip failing explorers.
      }
    }
  }

  const dedup = new Map<string, OrphanInflow>();
  for (const row of found) {
    const key = `${row.chain}:${row.txHash}`;
    if (known.has(row.txHash.toLowerCase())) continue;
    if (!dedup.has(key)) dedup.set(key, row);
  }

  return [...dedup.values()].sort((a, b) =>
    b.transferredAt.localeCompare(a.transferredAt),
  );
}

export type { WalletChain };
