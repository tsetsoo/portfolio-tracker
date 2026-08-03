import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server tree for Pi / VPS deploys (see deploy/pi/).
  output: "standalone",
  serverExternalPackages: [
    "better-sqlite3",
    "bitcoinjs-lib",
    "bip32",
    "@bitcoinerlab/secp256k1",
    "bs58check",
  ],
};

export default nextConfig;
