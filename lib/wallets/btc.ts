import { BTC_MATCH_SATS, BTC_WEAK_SATS } from "@/lib/wallets/match";

export type BtcTxResolution = {
  address: string;
  amount: number;
  deltaSats: number;
  confidence: "matched" | "weak" | "mismatch";
};

type MempoolVout = {
  scriptpubkey_address?: string;
  value?: number;
};

type MempoolTx = {
  vout?: MempoolVout[];
};

type MempoolAddress = {
  chain_stats?: {
    funded_txo_sum?: number;
    spent_txo_sum?: number;
  };
};

const MEMPOOL_BASE = "https://mempool.space/api";
const BLOCKSTREAM_BASE = "https://blockstream.info/api";

const BALANCE_APIS = [BLOCKSTREAM_BASE, MEMPOOL_BASE];

export function pickClosestBtcOutput(
  csvAmountBtc: number,
  outputs: Array<{ address: string; valueSats: number }>,
): BtcTxResolution | null {
  if (outputs.length === 0) return null;
  const targetSats = Math.round(csvAmountBtc * 1e8);
  const ranked = outputs
    .map((out) => ({
      ...out,
      deltaSats: Math.abs(out.valueSats - targetSats),
    }))
    .sort((a, b) => a.deltaSats - b.deltaSats);
  const best = ranked[0]!;
  let confidence: BtcTxResolution["confidence"] = "mismatch";
  if (best.deltaSats <= BTC_MATCH_SATS) confidence = "matched";
  else if (best.deltaSats <= BTC_WEAK_SATS) confidence = "weak";
  return {
    address: best.address,
    amount: best.valueSats / 1e8,
    deltaSats: best.deltaSats,
    confidence,
  };
}

export async function resolveBtcTransaction(
  txHash: string,
  csvAmountBtc: number,
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    /** When set, only outputs paying these addresses are considered (CDC batch txs). */
    knownAddresses?: string[];
  } = {},
): Promise<BtcTxResolution | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const bases = options.baseUrl ? [options.baseUrl] : BALANCE_APIS;
  const hash = txHash.toLowerCase();

  let tx: MempoolTx | null = null;
  for (const base of bases) {
    try {
      const response = await fetchImpl(`${base}/tx/${hash}`);
      if (!response.ok) continue;
      tx = (await response.json()) as MempoolTx;
      break;
    } catch {
      // try next API
    }
  }
  if (!tx) return null;

  const outputs = (tx.vout ?? [])
    .filter(
      (vout): vout is MempoolVout & { scriptpubkey_address: string; value: number } =>
        typeof vout.scriptpubkey_address === "string" &&
        typeof vout.value === "number",
    )
    .map((vout) => ({
      address: vout.scriptpubkey_address,
      valueSats: vout.value,
    }));

  const known = (options.knownAddresses ?? [])
    .map((address) => address.trim())
    .filter(Boolean);
  if (known.length > 0) {
    const knownSet = new Set(known);
    const toKnown = outputs.filter((out) => knownSet.has(out.address));
    return pickClosestBtcOutput(csvAmountBtc, toKnown);
  }

  return pickClosestBtcOutput(csvAmountBtc, outputs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchBtcBalance(
  address: string,
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    /** Delay before request (rate-limit pacing). */
    throttleMs?: number;
  } = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.throttleMs && options.throttleMs > 0) {
    await sleep(options.throttleMs);
  }
  const bases = options.baseUrl ? [options.baseUrl] : BALANCE_APIS;
  let lastError: unknown;
  for (const base of bases) {
    try {
      const response = await fetchImpl(`${base}/address/${address}`);
      if (!response.ok) {
        lastError = new Error(`${base} HTTP ${response.status}`);
        continue;
      }
      const body = (await response.json()) as MempoolAddress;
      const funded = body.chain_stats?.funded_txo_sum ?? 0;
      const spent = body.chain_stats?.spent_txo_sum ?? 0;
      return (funded - spent) / 1e8;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Bitcoin balance APIs unavailable");
}
