"use client";

import { useState, useTransition } from "react";

import {
  addEthWalletAction,
  refreshBalancesAction,
  removeWalletAction,
  renameWalletAction,
  scanWithdrawalsAction,
  setBtcXpubAction,
  type WalletListItem,
} from "@/app/actions/wallets";
import type { WalletChain, WalletTransfer } from "@/lib/wallets/types";

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function shortXpub(xpub: string): string {
  if (xpub.length <= 20) return xpub;
  return `${xpub.slice(0, 10)}…${xpub.slice(-8)}`;
}

function explorerUrl(chain: WalletChain, address: string): string {
  return chain === "eth"
    ? `https://etherscan.io/address/${address}`
    : `https://mempool.space/address/${address}`;
}

function txExplorerUrl(chain: WalletChain, txHash: string): string {
  return chain === "eth"
    ? `https://etherscan.io/tx/${txHash}`
    : `https://mempool.space/tx/${txHash}`;
}

function statusClass(status: string): string {
  if (status === "matched") return "gain";
  if (status === "mismatch") return "loss";
  if (status === "weak") return "warning-text";
  return "muted";
}

function formatQty(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 8 }).format(
    value,
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
  const [xpub, setXpub] = useState("");
  const [btcLabel, setBtcLabel] = useState("");

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
    <div className="wallets-manager">
      <div className="wallets-toolbar">
        <button
          type="button"
          className="primary-button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              const result = await scanWithdrawalsAction();
              return `Scan done: ${result.resolved} resolved (${result.matched} matched, ${result.mismatched} mismatch, ${result.weak} weak, ${result.unresolved} unresolved).`;
            })
          }
        >
          Scan withdrawals
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={isPending || wallets.length === 0}
          onClick={() =>
            run(async () => {
              const result = await refreshBalancesAction();
              return `Refreshed ${result.updated} wallet balances.`;
            })
          }
        >
          Refresh balances
        </button>
        {pendingCount > 0 && (
          <span className="muted">
            {pendingCount} transfer{pendingCount === 1 ? "" : "s"} awaiting scan
          </span>
        )}
      </div>

      {message && <p className="form-message">{message}</p>}

      <section className="wallet-add-panel" aria-label="Add wallets">
        <form
          className="wallet-add-form"
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
          <span className="wallet-add-chain">ETH</span>
          <label className="wallet-address-field">
            Ethereum address
            <input
              value={ethAddress}
              onChange={(event) => setEthAddress(event.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label>
            Label
            <input
              value={ethLabel}
              onChange={(event) => setEthLabel(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <button type="submit" className="secondary-button" disabled={isPending}>
            Add ETH
          </button>
        </form>

        <form
          className="wallet-xpub-form"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              await setBtcXpubAction({ xpub, label: btcLabel });
              setXpub("");
              setBtcLabel("");
              return hasBtcXpub
                ? "Bitcoin xpub replaced. Balances refreshing."
                : "Bitcoin xpub saved. Balances refreshing.";
            });
          }}
        >
          <span className="wallet-add-chain">BTC</span>
          <label className="wallet-address-field">
            Account xpub / ypub / zpub
            <input
              value={xpub}
              onChange={(event) => setXpub(event.target.value)}
              placeholder="zpub… (native SegWit) or xpub… / ypub…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label>
            Label
            <input
              value={btcLabel}
              onChange={(event) => setBtcLabel(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <button type="submit" className="secondary-button" disabled={isPending}>
            {hasBtcXpub ? "Replace xpub" : "Save xpub"}
          </button>
        </form>
        <p className="muted wallet-xpub-hint">
          Watch-only: paste the account extended public key from your wallet
          software. Receive + change addresses are derived (gap limit 20). Never
          paste a seed phrase.
        </p>
      </section>

      {wallets.length === 0 ? (
        <p className="holdings-empty">
          Add an Ethereum address and/or a Bitcoin xpub, import Crypto.com
          history for withdrawal hashes, then Scan.
        </p>
      ) : (
        <div className="managed-holdings">
          {wallets.map((wallet) => {
            const transfers = transfersByWallet[wallet.id] ?? [];
            return (
              <article className="managed-holding" key={wallet.id}>
                <div className="managed-holding-summary">
                  <div className="holding-identity">
                    <span>{wallet.chain.toUpperCase()}</span>
                    <p>
                      {wallet.chain === "btc" && wallet.xpub ? (
                        <span>
                          {wallet.label || "Bitcoin (xpub)"}
                        </span>
                      ) : (
                        <a
                          href={explorerUrl(wallet.chain, wallet.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {wallet.label || shortAddress(wallet.address)}
                        </a>
                      )}
                    </p>
                    {wallet.chain === "btc" && wallet.xpub ? (
                      <small className="muted">
                        {wallet.scriptType ?? "xpub"} · {shortXpub(wallet.xpub)}{" "}
                        · {wallet.addresses.length} derived
                      </small>
                    ) : (
                      wallet.label && (
                        <small className="muted">
                          {shortAddress(wallet.address)}
                        </small>
                      )
                    )}
                  </div>
                  <div className="managed-quantity">
                    <span>Balance (info)</span>
                    <strong>
                      {formatQty(wallet.balance)} {wallet.balanceAsset ?? ""}
                    </strong>
                  </div>
                  <div className="holding-value">
                    <strong>
                      {wallet.transferCount} linked withdrawal
                      {wallet.transferCount === 1 ? "" : "s"}
                    </strong>
                    <span
                      className={
                        wallet.mismatchCount > 0 ? "loss" : "muted"
                      }
                    >
                      {wallet.mismatchCount > 0
                        ? `${wallet.mismatchCount} mismatch`
                        : "No mismatches"}
                    </span>
                  </div>
                </div>

                <div className="managed-holding-actions">
                  <form
                    className="manual-value-form"
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
                    <label>
                      Label
                      <input
                        name="label"
                        defaultValue={wallet.label ?? ""}
                        placeholder="Nickname"
                      />
                    </label>
                    <button type="submit" className="secondary-button">
                      Save
                    </button>
                  </form>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={isPending}
                    onClick={() =>
                      run(async () => {
                        await removeWalletAction(wallet.id);
                        return "Wallet removed (transfers kept unresolved).";
                      })
                    }
                  >
                    Remove
                  </button>
                </div>

                {wallet.addresses.length > 0 && wallet.chain === "btc" && (
                  <details className="lots-disclosure">
                    <summary>
                      <span className="lots-summary-label">
                        Derived addresses
                        <em>{wallet.addresses.length}</em>
                      </span>
                      <span className="lots-chevron" aria-hidden="true" />
                    </summary>
                    <ul className="wallet-address-list">
                      {wallet.addresses.map((addr) => (
                        <li key={addr}>
                          <a
                            href={explorerUrl(wallet.chain, addr)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {addr}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {transfers.length > 0 && (
                  <details className="lots-disclosure" open>
                    <summary>
                      <span className="lots-summary-label">
                        Withdrawals
                        <em>
                          {transfers.length}{" "}
                          {transfers.length === 1 ? "transfer" : "transfers"}
                        </em>
                      </span>
                      <span className="lots-chevron" aria-hidden="true" />
                    </summary>
                    <div className="lots-scroll">
                      <table className="lots-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Asset</th>
                            <th className="numeric">CSV amt</th>
                            <th className="numeric">On-chain</th>
                            <th>Status</th>
                            <th>Tx</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transfers.map((transfer) => (
                            <tr key={transfer.id}>
                              <td>{transfer.transferredAt}</td>
                              <td>{transfer.asset}</td>
                              <td className="numeric">
                                {formatQty(transfer.amount)}
                              </td>
                              <td className="numeric">
                                {formatQty(transfer.onchainAmount)}
                              </td>
                              <td className={statusClass(transfer.onchainStatus)}>
                                {transfer.onchainStatus}
                                {transfer.notes ? (
                                  <small className="muted">
                                    {" "}
                                    · {transfer.notes}
                                  </small>
                                ) : null}
                              </td>
                              <td>
                                <a
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
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}

      {unlinkedTransfers.length > 0 && (
        <details className="lots-disclosure" open>
          <summary>
            <span className="lots-summary-label">
              Unlinked withdrawals
              <em>
                {unlinkedTransfers.length}{" "}
                {unlinkedTransfers.length === 1 ? "transfer" : "transfers"}
              </em>
            </span>
            <span className="lots-chevron" aria-hidden="true" />
          </summary>
          <div className="lots-scroll">
            <table className="lots-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Chain</th>
                  <th>Asset</th>
                  <th className="numeric">CSV amt</th>
                  <th>Status</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {unlinkedTransfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>{transfer.transferredAt}</td>
                    <td>{transfer.chain.toUpperCase()}</td>
                    <td>{transfer.asset}</td>
                    <td className="numeric">{formatQty(transfer.amount)}</td>
                    <td className={statusClass(transfer.onchainStatus)}>
                      {transfer.onchainStatus}
                      {transfer.notes ? (
                        <small className="muted"> · {transfer.notes}</small>
                      ) : null}
                    </td>
                    <td>
                      <a
                        href={txExplorerUrl(transfer.chain, transfer.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        view
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
