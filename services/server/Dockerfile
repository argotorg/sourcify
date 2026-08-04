# Needs to be run from the project root context e.g. `cd sourcify/ && docker build -f services/monitor/Dockerfile .`

# Builder image
FROM node:22.22.0-bookworm@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c as builder

RUN mkdir -p /home/app
WORKDIR /home/app

COPY . .

# Install server's dependencies and build the server
RUN npm ci --workspace=sourcify-server --include-workspace-root
RUN npx lerna run build --scope sourcify-server

######################
## Production image ##
######################
FROM node:22.22.0-trixie-slim@sha256:465a8c8f0f4103861bcbcf3e512608394b7155eccb1955425f4ea3f672ddc53e as production

# Fe compiler (v26.0.0-alpha.12+) requires libssl3 and glibc >= 2.39
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/app/services/server

WORKDIR /home/app/
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY lerna.json ./lerna.json
COPY nx.json ./nx.json

COPY --from=builder /home/app/packages/ ./packages/
COPY --from=builder /home/app/services/server/ ./services/server/

RUN npm ci --workspace=sourcify-server --include-workspace-root --omit=dev

LABEL org.opencontainers.image.source https://github.com/argotorg/sourcify
LABEL org.opencontainers.image.licenses MIT

# Set default value for ARG
ARG NODE_ENV=production

# Set environment variables
ENV NODE_ENV=${NODE_ENV} \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /home/app/services/server
# node command has to be used directly for SIGTERM handling (NOT npm start)
CMD ["node", "dist/server/cli.js"]
