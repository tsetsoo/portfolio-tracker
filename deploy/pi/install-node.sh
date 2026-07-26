#!/usr/bin/env bash
set -euo pipefail
# Install Node.js armv7l into /opt/portfolio/node (idempotent).
# Run on the Pi: sudo ./install-node.sh

NODE_VERSION="${NODE_VERSION:-v20.19.4}"
ARCH="linux-armv7l"
PREFIX="/opt/portfolio/node"
URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${ARCH}.tar.xz"

if [[ -x "$PREFIX/bin/node" ]]; then
  echo "node already present: $($PREFIX/bin/node -v)"
  exit 0
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "downloading $URL"
curl -fsSL "$URL" -o "$tmpdir/node.tar.xz"
tar -xJf "$tmpdir/node.tar.xz" -C "$tmpdir"
src="$(echo "$tmpdir"/node-"${NODE_VERSION}"-"${ARCH}")"
rm -rf "$PREFIX"
mkdir -p /opt/portfolio
mv "$src" "$PREFIX"
"$PREFIX/bin/node" -v
"$PREFIX/bin/npm" -v
echo "installed to $PREFIX"
