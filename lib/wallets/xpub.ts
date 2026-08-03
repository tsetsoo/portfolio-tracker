import BIP32Factory from "bip32";
import * as ecc from "@bitcoinerlab/secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import bs58check from "bs58check";

const bip32 = BIP32Factory(ecc);

export type BtcScriptType = "p2wpkh" | "p2sh-p2wpkh" | "p2pkh";

export type DerivedBtcAddress = {
  address: string;
  path: string;
  isChange: boolean;
  index: number;
};

const XPUB_VERSION = Buffer.from("0488b21e", "hex");

/** Prefer modern types first when probing ambiguous xpubs. */
const AMBIGUOUS_PROBE_ORDER: BtcScriptType[] = [
  "p2wpkh",
  "p2sh-p2wpkh",
  "p2pkh",
];

function prefixScriptType(extendedKey: string): BtcScriptType | "ambiguous" {
  if (extendedKey.startsWith("zpub") || extendedKey.startsWith("Zpub")) {
    return "p2wpkh";
  }
  if (extendedKey.startsWith("ypub") || extendedKey.startsWith("Ypub")) {
    return "p2sh-p2wpkh";
  }
  if (extendedKey.startsWith("xpub") || extendedKey.startsWith("tpub")) {
    // Classic xpub version bytes are reused by Ledger/etc for BIP84/49
    // account keys — script type is not implied by the prefix alone.
    return "ambiguous";
  }
  throw new Error("Unsupported key. Paste an xpub, ypub, or zpub.");
}

/** Normalize SLIP-0132 keys to bip32-js xpub version bytes. */
export function toStandardXpub(extendedKey: string): string {
  const trimmed = extendedKey.trim();
  if (!trimmed) throw new Error("xpub is required");
  const decoded = Buffer.from(bs58check.decode(trimmed));
  if (decoded.length < 4) throw new Error("Invalid extended public key");
  const rest = decoded.subarray(4);
  return bs58check.encode(Buffer.concat([XPUB_VERSION, rest]));
}

export function detectBtcScriptType(extendedKey: string): BtcScriptType {
  const inferred = prefixScriptType(extendedKey.trim());
  // Bare xpub does not encode script type; prefer native segwit (BIP84).
  return inferred === "ambiguous" ? "p2wpkh" : inferred;
}

function addressFromPubkey(
  publicKey: Buffer,
  scriptType: BtcScriptType,
): string {
  const network = bitcoin.networks.bitcoin;
  if (scriptType === "p2wpkh") {
    const { address } = bitcoin.payments.p2wpkh({ pubkey: publicKey, network });
    if (!address) throw new Error("Failed to derive bc1 address");
    return address;
  }
  if (scriptType === "p2sh-p2wpkh") {
    const { address } = bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey: publicKey, network }),
      network,
    });
    if (!address) throw new Error("Failed to derive 3… address");
    return address;
  }
  const { address } = bitcoin.payments.p2pkh({ pubkey: publicKey, network });
  if (!address) throw new Error("Failed to derive 1… address");
  return address;
}

export function deriveBtcAddress(
  extendedKey: string,
  isChange: boolean,
  index: number,
  scriptType?: BtcScriptType,
): DerivedBtcAddress {
  const type = scriptType ?? detectBtcScriptType(extendedKey);
  const node = bip32
    .fromBase58(toStandardXpub(extendedKey))
    .derive(isChange ? 1 : 0)
    .derive(index);
  const address = addressFromPubkey(Buffer.from(node.publicKey), type);
  return {
    address,
    path: `${isChange ? 1 : 0}/${index}`,
    isChange,
    index,
  };
}

/**
 * Derive receive (0/*) and change (1/*) addresses.
 * Stops each chain after `gapLimit` consecutive unused indexes once
 * `usedAddresses` marks which derived addresses have history; when scanning
 * cold (empty set), derives `gapLimit` of each chain as a starting window.
 */
export function deriveBtcAddressWindow(
  extendedKey: string,
  options: {
    gapLimit?: number;
    maxIndex?: number;
    usedAddresses?: Set<string>;
    scriptType?: BtcScriptType;
  } = {},
): DerivedBtcAddress[] {
  const gapLimit = options.gapLimit ?? 20;
  const maxIndex = options.maxIndex ?? 200;
  const used = options.usedAddresses ?? new Set<string>();
  const type = options.scriptType ?? detectBtcScriptType(extendedKey);
  const out: DerivedBtcAddress[] = [];

  for (const isChange of [false, true]) {
    let gap = 0;
    for (let index = 0; index <= maxIndex && gap < gapLimit; index++) {
      const derived = deriveBtcAddress(extendedKey, isChange, index, type);
      out.push(derived);
      if (used.has(derived.address)) gap = 0;
      else gap += 1;
    }
  }
  return out;
}

export function parseBtcXpub(
  extendedKey: string,
  options: { scriptType?: BtcScriptType } = {},
): {
  xpub: string;
  scriptType: BtcScriptType;
  firstReceive: string;
} {
  const xpub = extendedKey.trim();
  const inferred = prefixScriptType(xpub);
  const scriptType =
    options.scriptType ??
    (inferred === "ambiguous" ? "p2wpkh" : inferred);
  // Validate by decoding + deriving first address
  toStandardXpub(xpub);
  const firstReceive = deriveBtcAddress(xpub, false, 0, scriptType).address;
  return { xpub, scriptType, firstReceive };
}

async function addressHasHistory(
  address: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `https://mempool.space/api/address/${address}`,
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      chain_stats?: { tx_count?: number };
    };
    return (body.chain_stats?.tx_count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve script type for an account extended key.
 * zpub/ypub are unambiguous; bare xpub is probed on-chain (0/0) preferring
 * native segwit, then nested, then legacy.
 */
export async function resolveBtcScriptType(
  extendedKey: string,
  options: {
    fetchImpl?: typeof fetch;
    scriptType?: BtcScriptType;
  } = {},
): Promise<BtcScriptType> {
  if (options.scriptType) return options.scriptType;

  const trimmed = extendedKey.trim();
  const inferred = prefixScriptType(trimmed);
  if (inferred !== "ambiguous") return inferred;

  const fetchImpl = options.fetchImpl ?? fetch;
  for (const type of AMBIGUOUS_PROBE_ORDER) {
    const address = deriveBtcAddress(trimmed, false, 0, type).address;
    if (await addressHasHistory(address, fetchImpl)) {
      return type;
    }
  }
  // Modern wallets almost always use native segwit for new accounts.
  return "p2wpkh";
}
