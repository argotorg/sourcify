# Needs to be run from the project root context e.g. `cd sourcify/ && docker build -f services/monitor/Dockerfile .`

# Builder image
FROM node:22.5.1-bullseye as builder

RUN mkdir -p /home/app
WORKDIR /home/app

COPY . .

# Install server's dependencies and build the server
RUN npm ci --workspace=sourcify-server --include-workspace-root
RUN npx lerna run build --scope sourcify-server

######################
## Production image ##
######################
FROM node:22.5.1-bullseye-slim as production

RUN mkdir -p /home/app/services/server

WORKDIR /home/app/
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY lerna.json ./lerna.json
COPY nx.json ./nx.json

COPY --from=builder /home/app/packages/ ./packages/
COPY --from=builder /home/app/services/server/ ./services/server/

RUN npm ci --workspace=sourcify-server --include-workspace-root --omit=dev

LABEL org.opencontainers.image.source https://github.com/ethereum/sourcify
LABEL org.opencontainers.image.licenses MIT

# Set default value for ARG
ARG NODE_ENV=production

# Set environment variable
ENV NODE_ENV=${NODE_ENV}

WORKDIR /home/app/services/server
# node command has to be used directly for SIGTERM handling (NOT npm start)
CMD ["node", "dist/server/cli.js"]
