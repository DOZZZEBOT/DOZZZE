# DOZZZE coordinator image — the HTTP job broker + optional SQLite store.
#
# Build locally:
#   docker build -t dozzze-coord -f docker/coordinator.Dockerfile .
#
# Run (ephemeral, no persistence):
#   docker run --rm -p 8787:8787 -e DOZZZE_COORD_API_KEYS=changeme dozzze-coord
#
# Run (persistent):
#   docker volume create dozzze-coord
#   docker run -d --name dozzze-coord -p 8787:8787 \
#     -v dozzze-coord:/data \
#     -e DOZZZE_COORD_API_KEYS=changeme \
#     -e DOZZZE_COORD_DB=/data/coord.sqlite \
#     ghcr.io/dozzzebot/dozzze-coord:latest

# ---- Build stage -------------------------------------------------------------
# Node 24 required for the built-in `node:sqlite` module the coordinator uses
# for persistent queue storage (no native deps, no gyp).
FROM node:24-alpine AS build
WORKDIR /app

# Copy the workspace skeleton first so npm can resolve it without the full src.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/sdk/package.json         packages/sdk/package.json
COPY packages/client/package.json      packages/client/package.json
COPY packages/coordinator/package.json packages/coordinator/package.json
COPY packages/node/package.json        packages/node/package.json

RUN npm ci --no-audit --no-fund

# Now copy sources and build the coordinator + its deps.
COPY packages/sdk         packages/sdk
COPY packages/client      packages/client
COPY packages/coordinator packages/coordinator

RUN npm run build -w @dozzze/sdk \
 && npm run build -w @dozzze/client \
 && npm run build -w @dozzze/coordinator

# ---- Runtime stage -----------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S dozzze && adduser -S -G dozzze dozzze && mkdir -p /data && chown dozzze:dozzze /data

# Copy only the pieces the coordinator actually needs at runtime.
COPY --from=build --chown=dozzze:dozzze /app/package.json /app/package.json
COPY --from=build --chown=dozzze:dozzze /app/package-lock.json /app/package-lock.json
COPY --from=build --chown=dozzze:dozzze /app/node_modules /app/node_modules
COPY --from=build --chown=dozzze:dozzze /app/packages/sdk/dist         /app/packages/sdk/dist
COPY --from=build --chown=dozzze:dozzze /app/packages/sdk/package.json /app/packages/sdk/package.json
COPY --from=build --chown=dozzze:dozzze /app/packages/coordinator/dist /app/packages/coordinator/dist
COPY --from=build --chown=dozzze:dozzze /app/packages/coordinator/package.json /app/packages/coordinator/package.json

USER dozzze
VOLUME ["/data"]
EXPOSE 8787

# Listen on 0.0.0.0 because containers; api keys SHOULD be set via env.
ENTRYPOINT ["node", "/app/packages/coordinator/dist/cli.js"]
CMD ["--host", "0.0.0.0", "--port", "8787"]
