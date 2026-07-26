#!/usr/bin/env bash
set -euo pipefail
# Install Node.js armv7l into /opt/portfolio/node (idempotent).
# Pi is Raspbian Buster (glibc 2.28) — official Node 20+ binaries need
# newer libstdc++/glibc, so we pin Node 18 LTS which still runs natively.
#
# Run on the Pi: sudo ./install-node.sh

NODE_VERSION="${NODE_VERSION:-v18.20.8}"
ARCH="linux-armv7l"
PREFIX="/opt/portfolio/node"
URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${ARCH}.tar.xz"

if [[ -x "$PREFIX/bin/node" ]] && "$PREFIX/bin/node" -v >/dev/null 2>&1; then
  current="$("$PREFIX/bin/node" -v)"
  if [[ "$current" == "$NODE_VERSION" ]]; then
    echo "node already present: $current"
    exit 0
  fi
  echo "replacing $current with $NODE_VERSION"
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
# npm's shebang uses `env node` — put PREFIX/bin on PATH for the check.
PATH="$PREFIX/bin:$PATH" "$PREFIX/bin/npm" -v
echo "installed to $PREFIX"
