import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

export default {
  server: {
    port: parseInt(process.env.SERVER_PORT || "17651"),
    maxFileSize: parseInt(process.env.SERVER_MAX_FILE_SIZE || "31457280"), // 30 MB
    enableProfile: Boolean(process.env.SERVER_ENABLE_PROFILE) || false,
  },
  proxy: process.env.HTTP_PROXY,
  solc: {
    solcBinRepo: process.env.SOLC_REPO_BIN || "./solc-repo/bin",
    solcJsRepo: process.env.SOLC_REPO_JS || "./solc-repo/js",
  },
  vyper: {
    vyperRepo: process.env.VYPER_REPO || "./vyper-repo",
  },
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    username: process.env.MYSQL_USERNAME || "root",
    password: process.env.MYSQL_PASSWORD || "root",
    database: process.env.MYSQL_DATABASE || "verification",
    dialect: "mysql",
    syncSchema: true,
    readonly: false,
    logging: false,
  },
  chains: {
    1: {
      name: "Conflux coreSpace testnet",
      supported: true,
      corespace: true,
      confluxscanApi: {
        apiURL: "https://api-testnet.confluxscan.org",
      },
      rpc: ["http://test.confluxrpc.com"],
      traceSupportedRPCs: [
        {
          type: "trace_transaction",
          index: 0,
        },
      ],
    },
    71: {
      name: "Conflux eSpace testnet",
      supported: true,
      confluxscanApi: {
        apiURL: "https://evmapi-testnet.confluxscan.org",
      },
      rpc: ["http://evmtestnet.confluxrpc.com"],
      traceSupportedRPCs: [
        {
          type: "trace_transaction",
          index: 0,
        },
      ],
    },
    1029: {
      name: "Conflux coreSpace mainnet",
      supported: true,
      corespace: true,
      confluxscanApi: {
        apiURL: "https://api-stage.confluxscan.org",
      },
      rpc: [
        "http://main.confluxrpc.com",
        "http://main-internal.confluxrpc.com",
      ],
      traceSupportedRPCs: [
        {
          type: "trace_transaction",
          index: 1,
        },
      ],
    },
    1030: {
      name: "Conflux eSpace mainnet",
      supported: true,
      confluxscanApi: {
        apiURL: "https://evmapi-stage.confluxscan.org",
      },
      rpc: ["http://evm.confluxrpc.com"],
      traceSupportedRPCs: [
        {
          type: "trace_transaction",
          index: 0,
        },
      ],
    },
    16602: {
      name: "0G Galileo Testnet",
      supported: true,
      corespace: false,
      confluxscanApi: {
        apiURL: "https://chainscan-test.0g.ai/open",
      },
      rpc: ["http://evmrpc-testnet.0g.ai"],
    },
    16661: {
      name: "0G mainnet",
      supported: true,
      corespace: false,
      confluxscanApi: {
        apiURL: "https://chainscan.0g.ai/open",
      },
      rpc: ["http://evmrpc.0g.ai"],
    },
    17000: {
      name: "Ethereum Holesky Testnet",
      supported: true,
      corespace: false,
      confluxscanApi: {
        apiURL: "https://api-holesky.etherscan.io",
        apiKeyEnvName: "ETHERSCAN_API_KEY",
      },
      rpc: [
        'https://ethereum-holesky-rpc.publicnode.com'
      ],
      traceSupportedRPCs: [
        {
          type: 'trace_transaction',
          index: 0,
        }
      ],
    },
    31337: {
      name: "Hardhat Network Localhost",
      supported: true,
      corespace: false,
      rpc: [`http://localhost:8545`],
    },
  },
};
