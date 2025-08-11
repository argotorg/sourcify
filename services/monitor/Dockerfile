# Needs to be run from the project root context e.g. `cd sourcify/ && docker build -f services/monitor/Dockerfile .`
FROM node:22.5.1-bookworm as builder
RUN mkdir -p /home/app
WORKDIR /home/app

COPY . .

RUN npm ci --workspace=sourcify-monitor --include-workspace-root
RUN npx lerna run build --scope sourcify-monitor

######################
## Production image ##
######################
FROM node:22.5.1-bookworm-slim as production

RUN mkdir -p /home/app/services/monitor

WORKDIR /home/app/
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY lerna.json ./lerna.json
COPY nx.json ./nx.json

COPY --from=builder /home/app/packages/ ./packages/
COPY --from=builder /home/app/services/monitor/ ./services/monitor/

RUN npm ci --workspace=sourcify-monitor --include-workspace-root --omit=dev
LABEL org.opencontainers.image.source https://github.com/ethereum/sourcify
LABEL org.opencontainers.image.licenses MIT

ARG ALCHEMY_API_KEY
ARG INFURA_API_KEY
ARG CF_ACCESS_CLIENT_ID
ARG CF_ACCESS_CLIENT_SECRET

# Set default value for ARG
ARG NODE_ENV=production

# Set environment variable
ENV NODE_ENV=${NODE_ENV}

WORKDIR /home/app/services/monitor

CMD ["node", "dist/index.js", "--chainsPath", "monitorChains.json" ]
