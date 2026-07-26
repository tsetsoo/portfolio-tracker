import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server tree for Pi / VPS deploys (see deploy/pi/).
  output: "standalone",
};

export default nextConfig;
