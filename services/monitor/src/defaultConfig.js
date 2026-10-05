const DEFAULT_IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";

const defaultConfig = {
  decentralizedStorages: {
    ipfs: {
      enabled: true,
      gateways: [DEFAULT_IPFS_GATEWAY, "https://gateway.pinata.cloud/ipfs/"],
      timeout: 30000,
      interval: 5000,
      retries: 5,
    },
  },
  sourcifyServerURLs: ["https://sourcify.dev/server/"],
  similarityVerification: {
    requestDelay: 15000,
  },
  defaultChainConfig: {
    startBlock: undefined,
    blockInterval: 10000,
    blockIntervalFactor: 1.1,
    blockIntervalUpperLimit: 300000,
    blockIntervalLowerLimit: 25,
    bytecodeInterval: 5000,
    bytecodeNumberOfTries: 5,
    traceInterval: 15000,
    traceNumberOfTries: 5,
    traceDelay: 0,
  },
  chainConfigs: {
    100: {
      traceDelay: 300000,
    },
  },
};

export default defaultConfig;
