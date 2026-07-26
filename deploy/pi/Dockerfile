# Cross-build Next standalone + better-sqlite3 for Raspberry Pi 3
# (armv7 / Raspbian Buster, glibc 2.28).
#
# Must run under the *target* platform (QEMU), not BUILDPLATFORM — otherwise
# better-sqlite3 ships amd64 .node binaries that won't load on the Pi.
#
# Build (from repo root):
#   docker buildx build --platform linux/arm/v7 -f deploy/pi/Dockerfile \
#     --target export --output type=local,dest=./pi-dist .
# Pin a last-published Buster tag (Buster variants were dropped from docker-node).
# Must include linux/arm/v7 so QEMU/buildx can produce Pi-compatible natives.
FROM node:18.19.1-buster AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Native module must match the Pi's glibc — build from source on buster armv7.
ENV npm_config_build_from_source=true
RUN npm ci --no-audit --no-fund

FROM node:18.19.1-buster AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build \
  && mkdir -p /out \
  && cp -a .next/standalone/. /out/ \
  && mkdir -p /out/.next \
  && cp -a .next/static /out/.next/static \
  && if [ -d public ]; then cp -a public /out/public; fi

# Export stage for `docker buildx build --output type=local`
FROM scratch AS export
COPY --from=build /out /
