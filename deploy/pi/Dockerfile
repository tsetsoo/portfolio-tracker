# Cross-build the Next standalone tree + better-sqlite3 for the Raspberry Pi.
#
# The Pi host is Raspbian Buster (glibc 2.28, libstdc++ GLIBCXX_3.4.25), which
# cannot run Node 20+ natively — those binaries need GLIBCXX_3.4.26, and
# side-loading a newer libstdc++ fails because it in turn wants GLIBC_2.29.
# See deploy/pi/install-node.sh.
#
# So the app runs inside a container instead, which brings its own userspace and
# makes the host's glibc irrelevant. This image is therefore BOTH the build image
# and the runtime image: better-sqlite3 is a native module, so its NODE_MODULE_-
# VERSION and glibc must match whatever executes it. The tag is written into the
# release payload as NODE_IMAGE and read back by deploy/pi/run-container.sh, so
# runtime can never drift from the ABI it was compiled against.
#
# bullseye (glibc 2.31), not bookworm (2.36), on purpose: the Pi runs Docker
# 20.10.5, which predates the 20.10.10 seccomp fix for clone3, and glibc >= 2.34
# containers fail on it.
#
# Must build under the *target* platform via QEMU, not BUILDPLATFORM, or the
# native .node binaries come out as amd64 and won't load on the Pi.
#
# Build (from repo root):
#   docker buildx build --platform linux/arm/v7 -f deploy/pi/Dockerfile \
#     --target export --output type=local,dest=./pi-dist .

ARG NODE_IMAGE=node:22-bullseye

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Compile better-sqlite3 here rather than downloading a prebuild, so it matches
# this image's Node ABI and glibc exactly.
ENV npm_config_build_from_source=true
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
ARG NODE_IMAGE
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build \
  && mkdir -p /out \
  && cp -a .next/standalone/. /out/ \
  && mkdir -p /out/.next \
  && cp -a .next/static /out/.next/static \
  && if [ -d public ]; then cp -a public /out/public; fi \
  && printf '%s\n' "${NODE_IMAGE}" > /out/NODE_IMAGE \
  && chmod -R a+rX /out

# Export stage for `docker buildx build --output type=local`
FROM scratch AS export
COPY --from=build /out /
