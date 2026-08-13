"use client";

import { type ReactNode, useState, useTransition } from "react";

import {
  addBchWalletAction,
  addEthWalletAction,
  findMissingInflowsAction,
  markOrphanGiftAction,
  markTransferGiftAction,
  refreshBalancesAction,
  removeWalletAction,
  renameWalletAction,
  scanWithdrawalsAction,
  setBtcXpubAction,
  setTransferManualCostAction,
  type WalletListItem,
} from "@/app/actions/wallets";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { FIELD_CONTROL } from "@/components/ui/Field";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatCostCoveragePercent } from "@/lib/wallets/cost-coverage";
import type {
  OrphanInflow,
  WalletChain,
  WalletTransfer,
} from "@/lib/wallets/types";
import type { BtcScriptType } from "@/lib/wallets/xpub";

const LINK =
  "text-dim underline decoration-line-strong underline-offset-2 transition-colors hover:text-text";

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function shortXpub(xpub: string): string {
  if (xpub.length <= 20) return xpub;
  return `${xpub.slice(0, 10)}…${xpub.slice(-8)}`;
}

function explorerUrl(chain: WalletChain, address: string): string {
  if (chain === "eth") return `https://etherscan.io/address/${address}`;
  if (chain === "bch") {
    return `https://blockchair.com/bitcoin-cash/address/${address}`;
  }
  return `https://mempool.space/address/${address}`;
}

function txExplorerUrl(chain: WalletChain, txHash: string): string {
  if (chain === "eth") return `https://etherscan.io/tx/${txHash}`;
  if (chain === "bch") {
    return `https://blockchair.com/bitcoin-cash/transaction/${txHash}`;
  }
  return `https://mempool.space/tx/${txHash}`;
}

function statusClass(status: string): string {
  if (status === "matched") return "text-gain";
  if (status === "mismatch") return "text-loss";
  if (status === "weak") return "text-warn";
  return "text-dim";
}

function formatQty(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 8 }).format(
    value,
  );
}

/** The collapsible panel repeated for addresses, withdrawals, and orphans. */
function Disclosure({
  label,
  count,
  open,
  children,
}: {
  label: string;
  count: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-line bg-canvas/40" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] transition-colors duration-150 hover:bg-elevated [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-baseline gap-2">
          {label}
          <em className="text-[11px] font-semibold normal-case not-italic tracking-normal text-dim">
            {count}
          </em>
        </span>
        <span
          aria-hidden="true"
          className="inline-block size-2 rotate-45 border-b-2 border-r-2 border-dim transition-transform duration-150 group-open:rotate-[225deg]"
        />
      </summary>
      {children}
    </details>
  );
}

export function WalletsManager({
  wallets,
  transfersByWallet,
  unlinkedTransfers = [],
  pendingCount,
}: {
  wallets: WalletListItem[];
  transfersByWallet: Record<string, WalletTransfer[]>;
  unlinkedTransfers?: WalletTransfer[];
  pendingCount: number;
}) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [ethAddress, setEthAddress] = useState("");
  const [ethLabel, setEthLabel] = useState("");
  const [bchAddress, setBchAddress] = useState("");
  const [bchLabel, setBchLabel] = useState("");
  const [xpub, setXpub] = useState("");
  const [btcLabel, setBtcLabel] = useState("");
  const [btcScriptType, setBtcScriptType] = useState<BtcScriptType | "auto">(
    "auto",
  );
  const [orphans, setOrphans] = useState<OrphanInflow[]>([]);

  const hasBtcXpub = wallets.some(
    (wallet) => wallet.chain === "btc" && wallet.xpub,
  );

  function run(action: () => Promise<string | void>) {
    startTransition(async () => {
      try {
        const okMessage = await action();
        if (okMessage) setMessage(okMessage);
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              const result = await scanWithdrawalsAction();
              setOrphans(result.orphans);
              return `Scan done: ${result.resolved} resolved (${result.matched} matched, ${result.mismatched} mismatch, ${result.weak} weak, ${result.unresolved} unresolved). ${result.orphans.length} unmatched inflow${result.orphans.length === 1 ? "" : "s"}.`;
            })
          }
        >
          Scan withdrawals
        </Button>
        <Button
          variant="secondary"
          disabled={isPending || wallets.length === 0}
          onClick={() =>
            run(async () => {
              const result = await refreshBalancesAction();
              return `Refreshed ${result.updated} wallet balances.`;
            })
          }
        >
          Refresh balances
        </Button>
        <Button
          variant="secondary"
          disabled={isPending || wallets.length === 0}
          onClick={() =>
            run(async () => {
              const found = await findMissingInflowsAction();
              setOrphans(found);
              return found.length === 0
                ? "No unmatched inflows found on tracked addresses."
                : `Found ${found.length} unmatched inflow${found.length === 1 ? "" : "s"}.`;
            })
          }
        >
          Find missing inflows
        </Button>
        {pendingCount > 0 && (
          <span className="text-[11px] text-dim">
            {pendingCount} transfer{pendingCount === 1 ? "" : "s"} awaiting scan
          </span>
        )}
      </div>

      {message && <p className="text-xs text-dim">{message}</p>}

      {orphans.length > 0 && (
        <Card aria-label="Unmatched inflows">
          <SectionHeading
            eyebrow="Needs attention"
            title="Unmatched inflows"
            meta={String(orphans.length)}
          />
          <p className="px-5 py-4 text-[11px] leading-relaxed text-dim">
            Coins arrived on your wallets without a matching imported withdrawal
            txid. Check the exchange history hinted below and re-import, or mark
            as Gift if there was no purchase cost.
          </p>
          <DataTable
            head={
              <tr>
                <th>Date</th>
                <th>Asset</th>
                <th className="numeric">Amount</th>
                <th>From</th>
                <th>Likely</th>
                <th>Where to look</th>
                <th>Tx</th>
                <th>Cost</th>
              </tr>
            }
          >
            {orphans.map((row) => (
              <tr key={`${row.chain}:${row.txHash}`}>
                <td className="whitespace-nowrap text-dim">
                  {row.transferredAt}
                </td>
                <td className="font-mono font-semibold">{row.asset}</td>
                <td className="numeric">{formatQty(row.amount)}</td>
                <td>
                  {row.fromAddress ? (
                    <a
                      className={`font-mono ${LINK}`}
                      href={explorerUrl(row.chain, row.fromAddress)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(row.fromAddress)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{row.guessedVenue}</td>
                <td className="text-dim">{row.searchHint}</td>
                <td>
                  <a
                    className={`font-mono ${LINK}`}
                    href={txExplorerUrl(row.chain, row.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(row.txHash)}
                  </a>
                </td>
                <td>
                  <Button
                    variant="secondary"
                    disabled={isPending}
                    onClick={() =>
                      run(async () => {
                        await markOrphanGiftAction({
                          chain: row.chain,
                          asset: row.asset,
                          amount: row.amount,
                          txHash: row.txHash,
                          transferredAt: row.transferredAt,
                          toAddress: row.toAddress,
                        });
                        setOrphans((prev) =>
                          prev.filter(
                            (o) =>
                              !(
                                o.chain === row.chain && o.txHash === row.txHash
                              ),
                          ),
                        );
                        return "Marked unmatched inflow as gift.";
                      })
                    }
                  >
                    Gift
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      )}

      <Card aria-label="Add wallets" className="p-5">
        <div className={`grid gap-4 ${FIELD_CONTROL}`}>
          <form
            className="grid items-end gap-3 md:grid-cols-[auto_minmax(12rem,1.6fr)_minmax(8rem,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await addEthWalletAction({
                  address: ethAddress,
                  label: ethLabel,
                });
                setEthAddress("");
                setEthLabel("");
                return "Ethereum address added.";
              });
            }}
          >
            <span className="self-center font-mono text-[11px] font-semibold text-faint">
              ETH
            </span>
            <label className="grid gap-1.5">
              <span className="eyebrow">Ethereum address</span>
              <input
                value={ethAddress}
                onChange={(event) => setEthAddress(event.target.value)}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Label</span>
              <input
                value={ethLabel}
                onChange={(event) => setEthLabel(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={isPending}>
              Add ETH
            </Button>
          </form>

          <form
            className="grid items-end gap-3 md:grid-cols-[auto_minmax(12rem,1.6fr)_minmax(8rem,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const wallet = await addBchWalletAction({
                  address: bchAddress,
                  label: bchLabel,
                });
                setBchAddress("");
                setBchLabel("");
                return `Bitcoin Cash address added (${wallet.addresses.length} total).`;
              });
            }}
          >
            <span className="self-center font-mono text-[11px] font-semibold text-faint">
              BCH
            </span>
            <label className="grid gap-1.5">
              <span className="eyebrow">Bitcoin Cash address</span>
              <input
                value={bchAddress}
                onChange={(event) => setBchAddress(event.target.value)}
                placeholder="bitcoincash:q… (added to one wallet)"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Label</span>
              <input
                value={bchLabel}
                onChange={(event) => setBchLabel(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={isPending}>
              Add BCH
            </Button>
          </form>

          <form
            className="grid items-end gap-3 md:grid-cols-[auto_minmax(12rem,1.6fr)_minmax(8rem,10rem)_minmax(7rem,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const wallet = await setBtcXpubAction({
                  xpub,
                  label: btcLabel,
                  scriptType: btcScriptType,
                });
                setXpub("");
                setBtcLabel("");
                const kind =
                  wallet.scriptType === "p2wpkh"
                    ? "native SegWit (bc1…)"
                    : wallet.scriptType === "p2sh-p2wpkh"
                      ? "nested SegWit (3…)"
                      : "legacy (1…)";
                return hasBtcXpub
                  ? `Bitcoin xpub replaced as ${kind}.`
                  : `Bitcoin xpub saved as ${kind}.`;
              });
            }}
          >
            <span className="self-center font-mono text-[11px] font-semibold text-faint">
              BTC
            </span>
            <label className="grid gap-1.5">
              <span className="eyebrow">Account xpub / ypub / zpub</span>
              <input
                value={xpub}
                onChange={(event) => setXpub(event.target.value)}
                placeholder="zpub… (native SegWit) or xpub… / ypub…"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Address type</span>
              <select
                value={btcScriptType}
                onChange={(event) =>
                  setBtcScriptType(event.target.value as BtcScriptType | "auto")
                }
              >
                <option value="auto">Auto (recommended)</option>
                <option value="p2wpkh">Native SegWit (bc1…)</option>
                <option value="p2sh-p2wpkh">Nested SegWit (3…)</option>
                <option value="p2pkh">Legacy (1…)</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="eyebrow">Label</span>
              <input
                value={btcLabel}
                onChange={(event) => setBtcLabel(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={isPending}>
              {hasBtcXpub ? "Replace xpub" : "Save xpub"}
            </Button>
          </form>

          <p className="max-w-3xl text-[11px] leading-relaxed text-dim">
            Watch-only: paste the account extended public key. Bare{" "}
            <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[10px] text-text">
              xpub
            </code>{" "}
            keys are ambiguous — Auto checks the chain for bc1… / 3… / 1…
            (Ledger often exports BIP84 as xpub). Never paste a seed phrase.
          </p>
        </div>
      </Card>

      {wallets.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-dim">
          Add an Ethereum or Bitcoin Cash address and/or a Bitcoin xpub, import
          Crypto.com history for withdrawal hashes, then Scan.
        </p>
      ) : (
        <div className="grid gap-4">
          {wallets.map((wallet) => {
            const transfers = transfersByWallet[wallet.id] ?? [];
            return (
              <Card as="article" key={wallet.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_150px_170px]">
                  <div className="min-w-0">
                    <span className="font-mono text-[13px] font-semibold">
                      {wallet.chain.toUpperCase()}
                    </span>
                    <p className="mt-0.5 truncate text-[11px] text-dim">
                      {wallet.chain === "btc" && wallet.xpub ? (
                        <span>{wallet.label || "Bitcoin (xpub)"}</span>
                      ) : wallet.chain === "bch" &&
                        wallet.addresses.length > 1 ? (
                        <span>{wallet.label || "Bitcoin Cash"}</span>
                      ) : (
                        <a
                          className={LINK}
                          href={explorerUrl(wallet.chain, wallet.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {wallet.label || shortAddress(wallet.address)}
                        </a>
                      )}
                    </p>
                    {wallet.chain === "btc" && wallet.xpub ? (
                      <small className="mt-0.5 block truncate font-mono text-[10px] text-faint">
                        {wallet.scriptType ?? "xpub"} · {shortXpub(wallet.xpub)}{" "}
                        · {wallet.addresses.length} derived
                      </small>
                    ) : wallet.chain === "bch" ? (
                      <small className="mt-0.5 block truncate font-mono text-[10px] text-faint">
                        {wallet.addresses.length} address
                        {wallet.addresses.length === 1 ? "" : "es"}
                        {wallet.label
                          ? ` · ${shortAddress(wallet.address)}`
                          : ""}
                      </small>
                    ) : (
                      wallet.label && (
                        <small className="mt-0.5 block truncate font-mono text-[10px] text-faint">
                          {shortAddress(wallet.address)}
                        </small>
                      )
                    )}
                  </div>

                  <div className="hidden sm:grid">
                    <span className="eyebrow">Balance (info)</span>
                    <strong className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
                      {formatQty(wallet.balance)} {wallet.balanceAsset ?? ""}
                    </strong>
                  </div>

                  <div className="grid justify-items-end">
                    <strong className="font-mono text-[13px] font-semibold tabular-nums">
                      {formatCostCoveragePercent(wallet.costCoverage ?? 0)}
                    </strong>
                    <span
                      className={`mt-0.5 text-[10px] ${
                        wallet.mismatchCount > 0 ? "text-loss" : "text-dim"
                      }`}
                    >
                      {wallet.transferCount} withdrawal
                      {wallet.transferCount === 1 ? "" : "s"}
                      {wallet.mismatchCount > 0
                        ? ` · ${wallet.mismatchCount} mismatch`
                        : ""}
                    </span>
                  </div>
                </div>

                {wallet.tokens && wallet.tokens.length > 0 && (
                  <ul className="border-t border-line px-5 py-3 font-mono text-[11px] text-dim">
                    {wallet.tokens.map((token) => (
                      <li key={token.asset} className="py-0.5">
                        {formatQty(token.balance)} {token.asset}
                        {token.valueBase != null && token.valueCurrency
                          ? ` · ${formatQty(token.valueBase)} ${token.valueCurrency}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}

                <div
                  className={`flex flex-wrap items-end gap-3 border-t border-line bg-canvas/40 px-5 py-3 ${FIELD_CONTROL}`}
                >
                  <form
                    className="flex flex-1 items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const next = String(data.get("label") ?? "");
                      run(async () => {
                        await renameWalletAction(wallet.id, next);
                        return "Label saved.";
                      });
                    }}
                  >
                    <label className="grid max-w-[200px] flex-1 gap-1.5">
                      <span className="eyebrow">Label</span>
                      <input
                        name="label"
                        defaultValue={wallet.label ?? ""}
                        placeholder="Nickname"
                      />
                    </label>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                  <Button
                    variant="danger"
                    className="ml-auto"
                    disabled={isPending}
                    onClick={() =>
                      run(async () => {
                        await removeWalletAction(wallet.id);
                        return "Wallet removed (transfers kept unresolved).";
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>

                {wallet.addresses.length > 0 && wallet.chain === "btc" && (
                  <Disclosure
                    label="Derived addresses"
                    count={wallet.addresses.length}
                  >
                    <ul className="px-5 pb-4 font-mono text-[11px]">
                      {wallet.addresses.map((addr) => (
                        <li key={addr} className="py-0.5 break-all">
                          <a
                            className={LINK}
                            href={explorerUrl(wallet.chain, addr)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {addr}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                )}

                {transfers.length > 0 && (
                  <Disclosure
                    label="Withdrawals"
                    open
                    count={`${transfers.length} ${transfers.length === 1 ? "transfer" : "transfers"}`}
                  >
                    <DataTable
                      head={
                        <tr>
                          <th>Date</th>
                          <th>Asset</th>
                          <th className="numeric">CSV amt</th>
                          <th className="numeric">Cost</th>
                          <th>Cost status</th>
                          <th className="numeric">On-chain</th>
                          <th>Status</th>
                          <th>Tx</th>
                          <th>Cost actions</th>
                        </tr>
                      }
                    >
                      {transfers.map((transfer) => (
                        <tr key={transfer.id}>
                          <td className="whitespace-nowrap text-dim">
                            {transfer.transferredAt}
                          </td>
                          <td className="font-mono font-semibold">
                            {transfer.asset}
                          </td>
                          <td className="numeric">
                            {formatQty(transfer.amount)}
                          </td>
                          <td className="numeric">
                            {transfer.costBasis != null && transfer.costCurrency
                              ? `${formatQty(transfer.costBasis)} ${transfer.costCurrency}`
                              : "—"}
                          </td>
                          <td className="text-dim">
                            {transfer.costStatus ?? "unknown"}
                          </td>
                          <td className="numeric">
                            {formatQty(transfer.onchainAmount)}
                          </td>
                          <td className={statusClass(transfer.onchainStatus)}>
                            {transfer.onchainStatus}
                            {transfer.notes ? (
                              <small className="text-faint">
                                {" "}
                                · {transfer.notes}
                              </small>
                            ) : null}
                          </td>
                          <td>
                            <a
                              className={LINK}
                              href={txExplorerUrl(
                                transfer.chain,
                                transfer.txHash,
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              view
                            </a>
                          </td>
                          <td>
                            <div
                              className={`flex items-center gap-2 ${FIELD_CONTROL}`}
                            >
                              {(transfer.costStatus === "unknown" ||
                                transfer.costStatus == null) && (
                                <Button
                                  variant="secondary"
                                  disabled={isPending}
                                  onClick={() =>
                                    run(async () => {
                                      await markTransferGiftAction(transfer.id);
                                      return "Marked as gift.";
                                    })
                                  }
                                >
                                  Gift
                                </Button>
                              )}
                              <form
                                className="flex items-center gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const data = new FormData(
                                    event.currentTarget,
                                  );
                                  const basis = Number(data.get("basis"));
                                  const currency = String(
                                    data.get("currency") ?? "EUR",
                                  );
                                  run(async () => {
                                    await setTransferManualCostAction(
                                      transfer.id,
                                      basis,
                                      currency,
                                    );
                                    return "Manual cost saved.";
                                  });
                                }}
                              >
                                <input
                                  name="basis"
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder="Cost"
                                  required
                                  className="w-20"
                                />
                                <input
                                  name="currency"
                                  defaultValue="EUR"
                                  className="w-14"
                                />
                                <Button type="submit" variant="secondary">
                                  Set
                                </Button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                  </Disclosure>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {unlinkedTransfers.length > 0 && (
        <Card>
          <Disclosure
            label="Unlinked withdrawals"
            open
            count={`${unlinkedTransfers.length} ${unlinkedTransfers.length === 1 ? "transfer" : "transfers"}`}
          >
            <DataTable
              head={
                <tr>
                  <th>Date</th>
                  <th>Chain</th>
                  <th>Asset</th>
                  <th className="numeric">CSV amt</th>
                  <th>Status</th>
                  <th>Tx</th>
                </tr>
              }
            >
              {unlinkedTransfers.map((transfer) => (
                <tr key={transfer.id}>
                  <td className="whitespace-nowrap text-dim">
                    {transfer.transferredAt}
                  </td>
                  <td className="font-mono">
                    {transfer.chain.toUpperCase()}
                  </td>
                  <td className="font-mono font-semibold">{transfer.asset}</td>
                  <td className="numeric">{formatQty(transfer.amount)}</td>
                  <td className={statusClass(transfer.onchainStatus)}>
                    {transfer.onchainStatus}
                    {transfer.notes ? (
                      <small className="text-faint"> · {transfer.notes}</small>
                    ) : null}
                  </td>
                  <td>
                    <a
                      className={LINK}
                      href={txExplorerUrl(transfer.chain, transfer.txHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view
                    </a>
                  </td>
                </tr>
              ))}
            </DataTable>
          </Disclosure>
        </Card>
      )}
    </div>
  );
}
