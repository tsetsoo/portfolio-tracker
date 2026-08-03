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

/** BIP32 version bytes → script type implied by SLIP-0132 prefixes. */
function scriptTypeFromPrefix(extendedKey: string): BtcScriptType {
  if (extendedKey.startsWith("zpub") || extendedKey.startsWith("Zpub")) {
    return "p2wpkh";
  }
  if (extendedKey.startsWith("ypub") || extendedKey.startsWith("Ypub")) {
    return "p2sh-p2wpkh";
  }
  if (extendedKey.startsWith("xpub") || extendedKey.startsWith("tpub")) {
    return "p2pkh";
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
  return scriptTypeFromPrefix(extendedKey.trim());
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

export function parseBtcXpub(extendedKey: string): {
  xpub: string;
  scriptType: BtcScriptType;
  firstReceive: string;
} {
  const xpub = extendedKey.trim();
  const scriptType = detectBtcScriptType(xpub);
  // Validate by deriving first address
  toStandardXpub(xpub);
  const firstReceive = deriveBtcAddress(xpub, false, 0, scriptType).address;
  return { xpub, scriptType, firstReceive };
}
