# Needs to be run from the project root context e.g. `cd sourcify/ && docker build -f services/monitor/Dockerfile .`
FROM node:22.22.0-bookworm@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c as builder
RUN mkdir -p /home/app
WORKDIR /home/app

COPY . .

RUN npm ci --workspace=sourcify-monitor --include-workspace-root
RUN npx lerna run build --scope sourcify-monitor

######################
## Production image ##
######################
FROM node:22.22.0-trixie-slim@sha256:465a8c8f0f4103861bcbcf3e512608394b7155eccb1955425f4ea3f672ddc53e as production

RUN mkdir -p /home/app/services/monitor

WORKDIR /home/app/
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY lerna.json ./lerna.json
COPY nx.json ./nx.json

COPY --from=builder /home/app/packages/ ./packages/
COPY --from=builder /home/app/services/monitor/ ./services/monitor/

RUN npm ci --workspace=sourcify-monitor --include-workspace-root --omit=dev
LABEL org.opencontainers.image.source https://github.com/argotorg/sourcify
LABEL org.opencontainers.image.licenses MIT

ARG ALCHEMY_API_KEY
ARG DRPC_API_KEY
ARG CF_ACCESS_CLIENT_ID
ARG CF_ACCESS_CLIENT_SECRET

# Set default value for ARG
ARG NODE_ENV=production

# Set environment variable
ENV NODE_ENV=${NODE_ENV}

WORKDIR /home/app/services/monitor

CMD ["node", "dist/index.js", "--chainsPath", "monitorChains.json" ]
