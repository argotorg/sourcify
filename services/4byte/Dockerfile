# Needs to be run from the project root context e.g. `cd sourcify/ && docker build -f services/4byte/Dockerfile .`

# Builder image
FROM node:22.5.1-bookworm as builder

RUN mkdir -p /home/app
WORKDIR /home/app

COPY . .

# Install 4byte service's dependencies and build
RUN npm ci --workspace=sourcify-4byte --include-workspace-root
RUN npx lerna run build --scope sourcify-4byte

######################
## Production image ##
######################
FROM node:22.5.1-bookworm-slim as production

RUN mkdir -p /home/app/services/4byte

WORKDIR /home/app/
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY lerna.json ./lerna.json
COPY nx.json ./nx.json

COPY --from=builder /home/app/packages/ ./packages/
COPY --from=builder /home/app/services/4byte/ ./services/4byte/

RUN npm ci --workspace=sourcify-4byte --include-workspace-root --omit=dev

LABEL org.opencontainers.image.source https://github.com/argotorg/sourcify
LABEL org.opencontainers.image.licenses MIT

# Set default value for ARG
ARG NODE_ENV=production
ARG PORT=80

# Set environment variable
ENV NODE_ENV=${NODE_ENV}
ENV PORT=${PORT}

WORKDIR /home/app/services/4byte
# node command has to be used directly for SIGTERM handling (NOT npm start)
CMD ["node", "dist/cli.js"]