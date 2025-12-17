const defaultConfig = {
  decentralizedStorages: {
    ipfs: {
      enabled: true,
      gateways: ["https://ipfs.io/ipfs/"],
      timeout: 30000,
      interval: 5000,
      retries: 5,
    },
  },
  sourcifyServerURLs: ["https://sourcify.dev/server/"],
  sourcifyRequestOptions: {
    maxRetries: 3,
    retryDelay: 30000,
  },
  defaultChainConfig: {
    startBlock: undefined,
    blockInterval: 10000,
    blockIntervalFactor: 1.1,
    blockIntervalUpperLimit: 300000,
    blockIntervalLowerLimit: 25,
    bytecodeInterval: 5000,
    bytecodeNumberOfTries: 5,
  },
};

export default defaultConfig;
