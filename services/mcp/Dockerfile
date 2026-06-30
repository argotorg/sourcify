# Needs to be run from the project root context e.g. `cd sourcify/ && docker build -f services/mcp/Dockerfile .`
FROM node:22.22.0-bookworm as builder
RUN mkdir -p /home/app
WORKDIR /home/app

COPY . .

RUN npm ci --workspace=sourcify-mcp --include-workspace-root
RUN npx lerna run build --scope sourcify-mcp

######################
## Production image ##
######################
FROM node:22.22.0-trixie-slim as production

RUN mkdir -p /home/app/services/mcp

WORKDIR /home/app/
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY lerna.json ./lerna.json
COPY nx.json ./nx.json

COPY --from=builder /home/app/services/mcp/ ./services/mcp/

RUN npm ci --workspace=sourcify-mcp --include-workspace-root --omit=dev
LABEL org.opencontainers.image.source https://github.com/argotorg/sourcify
LABEL org.opencontainers.image.licenses MIT

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /home/app/services/mcp

# The server speaks MCP over stdio; run it attached to a client that owns stdin/stdout.
CMD ["node", "dist/index.js"]
