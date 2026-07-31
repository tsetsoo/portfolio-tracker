export type EthTxResolution = {
  address: string;
  amount: number;
  asset: string;
};

type JsonRpcResult = {
  result?: {
    to?: string | null;
    value?: string;
    input?: string;
  } | null;
};

const DEFAULT_RPCS = [
  "https://ethereum.publicnode.com",
  "https://rpc.ankr.com/eth",
  "https://1rpc.io/eth",
];

/** Well-known ERC-20 contracts we treat as mainnet token transfers. */
const ERC20_ASSETS: Record<string, { asset: string; decimals: number }> = {
  "0x514910771af9ca656af840dff83e8264ecf986ca": {
    asset: "LINK",
    decimals: 18,
  },
};

async function ethRpc(
  method: string,
  params: unknown[],
  fetchImpl: typeof fetch,
  rpcUrls: string[],
): Promise<unknown> {
  let lastError: unknown;
  for (const url of rpcUrls) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
      });
      if (!response.ok) {
        lastError = new Error(`RPC HTTP ${response.status}`);
        continue;
      }
      const body = (await response.json()) as JsonRpcResult & {
        error?: { message?: string };
      };
      if (body.error) {
        lastError = new Error(body.error.message ?? "RPC error");
        continue;
      }
      return body.result ?? null;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Ethereum RPC unavailable");
}

function decodeErc20Transfer(
  input: string,
): { to: string; rawAmount: bigint } | null {
  if (!input.startsWith("0xa9059cbb") || input.length < 138) return null;
  return {
    to: `0x${input.slice(34, 74)}`.toLowerCase(),
    rawAmount: BigInt(`0x${input.slice(74, 138)}`),
  };
}

export async function resolveEthTransaction(
  txHash: string,
  options: {
    fetchImpl?: typeof fetch;
    rpcUrls?: string[];
    expectedAsset?: string;
  } = {},
): Promise<EthTxResolution | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrls = options.rpcUrls ?? DEFAULT_RPCS;
  const hash = txHash.toLowerCase().startsWith("0x")
    ? txHash.toLowerCase()
    : `0x${txHash.toLowerCase()}`;

  const tx = (await ethRpc(
    "eth_getTransactionByHash",
    [hash],
    fetchImpl,
    rpcUrls,
  )) as JsonRpcResult["result"];
  if (!tx) return null;

  const input = tx.input ?? "0x";
  const contract = (tx.to ?? "").toLowerCase();
  const transfer = decodeErc20Transfer(input);
  if (transfer) {
    const meta = ERC20_ASSETS[contract];
    const asset = meta?.asset ?? options.expectedAsset ?? "ERC20";
    const decimals = meta?.decimals ?? 18;
    const amount = Number(transfer.rawAmount) / 10 ** decimals;
    return { address: transfer.to, amount, asset };
  }

  const valueWei = BigInt(tx.value ?? "0x0");
  const amount = Number(valueWei) / 1e18;
  if (!tx.to) return null;
  return {
    address: tx.to.toLowerCase(),
    amount,
    asset: "ETH",
  };
}

export async function fetchEthBalance(
  address: string,
  options: { fetchImpl?: typeof fetch; rpcUrls?: string[] } = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrls = options.rpcUrls ?? DEFAULT_RPCS;
  const result = (await ethRpc(
    "eth_getBalance",
    [address.toLowerCase(), "latest"],
    fetchImpl,
    rpcUrls,
  )) as string;
  return Number(BigInt(result)) / 1e18;
}
