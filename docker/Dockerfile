# DOZZZE node — minimal container image for running `dozzze start`.
# This image does NOT ship Ollama. Point the node at an Ollama endpoint on
# the host (e.g. `http://host.docker.internal:11434`) via DOZZZE_OLLAMA_URL.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
RUN npm install --omit=optional --no-audit --no-fund
RUN npm run build --workspaces --if-present

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Non-root user for the node process.
RUN addgroup -S dozzze && adduser -S -G dozzze dozzze
COPY --from=build --chown=dozzze:dozzze /app /app
USER dozzze
ENV DOZZZE_HOME=/home/dozzze/.dozzze
VOLUME ["/home/dozzze/.dozzze"]
ENTRYPOINT ["node", "/app/packages/node/dist/cli.js"]
CMD ["start"]
