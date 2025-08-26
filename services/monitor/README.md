# sourcify-monitor

Sourcify Monitor is a standalone service that listens to various EVM chains for new contract creations and automatically submits them to the Sourcify API for verification.

This is only possible for Solidity contracts that has its metadata hash published in a DecentralizedStorage (IPFS, Swarm, etc). Currently only IPFS is supported.

Learn more about the contract metadata in the [Solidity docs](https://docs.soliditylang.org/en/latest/metadata.html) and [Sourcify docs](https://docs.sourcify.dev/docs/metadata/). We also have a nice playground showing everything in action at [playground.sourcify.dev](https://playground.sourcify.dev).

## Config

### Chains to Monitor

First you need to provide which chains to monitor in a json file.

```json
[
  {
    "chainId": 1,
    "name": "Ethereum Mainnet",
    "rpc": ["http://localhost:8545", "https://mainnet.infura.io/v3/{INFURA_API_KEY}"],
  },
  {
    "chainId": 11155111,
    "name": "Ethereum Sepolia Testnet",
    "rpc": ["http://localhost:8545", "https://rpc2.sepolia.org/ "],
  },
  ...
]
```

Infura and Alchemy keys must be placed in the url string as above in `{INFURA_API_KEY}`

See [monitorChains.json](./monitorChains.json) for a full example and to see which chains we monitor ourselves. You can also use the [chainid.network/chains.json](https://chainid.network/chains.json) to find chains.

### Monitor Config

Optionally you can pass a monitor config in a `config.json` file. If you don't, the [default config](src/defaultConfig.js) will be used. If you leave any field blank, it will be filled with the default config.

The structure of the file is as such:

```js
  decentralizedStorages: {
    ipfs: {
      enabled: true,
      gateways: [
        // Passing gateway as a string will use default settings
        "https://ipfs.io/ipfs/",
        // If you need gateways specific settings you can pass them in an object
        {
          url: "http://localhost:8080/ipfs/",
          headers: {
            "Authentication": "xxx"
          }
        }
      ],
      // Time when the request to the gateway will timeout i.e. canceled in ms
      timeout: 30000,
      // Time between each request to the gateway in ms
      interval: 5000,
      // Number of retries before giving up
      retries: 5,
      // (optional) Headers passed to the fetch headers parameter
      headers: {}
    },
    // can also have swarm
  },
  // Sourcify instances to verify the contracts on. Can be multiple
  sourcifyServerURLs: ["https://sourcify.dev/server/", "http://localhost:5555/"],
  sourcifyRequestOptions: {
    // Maximum number of retry attempts for contract verification requests after encountering an error
    maxRetries: 3,
    // Delay in milliseconds between each retry attempt for verification requests to Sourcify
    retryDelay: 30000,
  },
  defaultChainConfig: {
    // Block to start monitoring from. If undefined, it will start from the latest block by asking the RPC `eth_blockNumber`
    startBlock: undefined,
    // Time between each block check in ms. This value is dynamically adjusted based on the block time.
    // When a block is successfully fetched, it's decreased by `blockIntervalFactor`, and vice versa.
    blockInterval: 10000,
    // The factor to increase/decrease the block interval by. Must be greater than 1.
    blockIntervalFactor: 1.1,
    // The upper and lower limit of the block interval in ms
    blockIntervalUpperLimit: 300000,
    blockIntervalLowerLimit: 100,
    // Time between each `eth_getCode` requets in ms
    bytecodeInterval: 5000,
    // Number of retries before giving up getting the contract bytecode.
    bytecodeNumberOfTries: 5,
  },
  // Can also pass each chain the same config as above. Non specified fields will be filled with the defaultChainConfig. Non specified chains will use the whole defaultChainConfig.
  chainConfigs: {
    1: {
      startBlock: 10000000,
      blockInterval: 12000, // Ethereum mainnet is set to 12s
    }
  }
```

### Environment variables

By default you can pass the following environment variables in `.env.template` for authenticating with the RPCs:

```bash
# If your RPCs are Alchemy or Infura
# In the rpc url it must have {INFURA_API_KEY} or {ALCHEMY_API_KEY}
ALCHEMY_API_KEY=
INFURA_API_KEY=

# ethpandaops.io authentication
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=

# Overrides the log level. Normally, if NODE_ENV production set to "info", otherwise "debug". Values can be silly, debug, info, warn, error
NODE_LOG_LEVEL=
# Port of the HTTP server to change the log level dynamically while the monitor is running
NODE_LOG_LEVEL_SERVER_PORT=3333
```

## Usage

You can run the Sourcify Monitor in two ways:

### 1. Run locally

Clone the [Sourcify monorepo](https://github.com/ethereum/sourcify)

```bash
git clone git@github.com:ethereum/sourcify.git
cd sourcify
```

Install and build the project:

```bash
npm install
npx lerna run build --scope sourcify-monitor
```

Run

```bash
node dist/index.js --chainsPath /path/to/your-chains.json --configPath /path/to/config.json
```

The `--chainsPath` and `--configPath` are optional. If not provided, the default paths will be used.

### 2. Run via Docker

If you want to build yourself, the builds need to be run from the project root context, e.g.:

```bash
cd sourcify/ && docker build -f services/server/Dockerfile .
```

The containers are published in the [Github Container Registry](https://github.com/ethereum/sourcify/pkgs/container/sourcify%2Fmonitor)

The recommended way to run the Sourcify Monitor is via Docker.

You need to pass the `monitorChains.json` and `config.json` files to the container. You can do this by mounting them as volumes:

```bash
$ docker pull ghcr.io/argotorg/sourcify/monitor:latest
$ docker run \
  -v /path/to/chains.json:/home/app/services/monitor/monitorChains.json \
  -v /path/to/config.json:/home/app/services/monitor/config.json \
  -e ALCHEMY_API_KEY=xxx \
  -e INFURA_API_KEY=xxx \
  ghcr.io/argotorg/sourcify/monitor:latest
```

## Setting log levels dynamically

The default log level of the monitor is set to "info". You can change the default value by setting the env var `NODE_LOG_LEVEL` on start.

You can also change the log level dynamically while the monitor is running through a simple (unauthenticated) HTTP server endpoint. The server port is set in `NODE_LOG_LEVEL_SERVER_PORT` env var (default: `3333`). Simply call:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"level": "debug"}' http://localhost:3333
```
