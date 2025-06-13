import path from "path"
import dotenv from "dotenv"
dotenv.config({ path: path.resolve(__dirname, "..", ".env") })

export default {
  server:{
    port: parseInt(process.env.SERVER_PORT || "17651"),
    maxFileSize: parseInt(process.env.SERVER_MAX_FILE_SIZE || "31457280") // 30 MB
  },
  solc:{
    solcBinRepo: process.env.SOLC_REPO_BIN || './solc-repo/bin',
    solcJsRepo: process.env.SOLC_REPO_JS || './solc-repo/js',
  },
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    username: process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || 'root',
    database: process.env.MYSQL_DATABASE || 'verification',
    dialect: 'mysql',
    syncSchema: true,
    readonly : false,
    logging: false,
  },
  chains: {
    1030: {
      name: "Conflux eSpace mainnet",
      chainId: 1030,
      supported: true,
      confluxscanApi: {
        apiURL: "https://evmapi-stage.confluxscan.org",
      },
      rpc: [
        'http://evm.confluxrpc.com'
      ],
      traceSupportedRPCs: [
        {
          type: 'trace_transaction',
          index: 0,
        }
      ],
    },
    71: {
      name: "Conflux eSpace testnet",
      chainId: 71,
      supported: true,
      confluxscanApi: {
        apiURL: "https://evmapi-testnet.confluxscan.org",
      },
      rpc: [
        'http://evmtestnet.confluxrpc.com'
      ],
      traceSupportedRPCs: [
        {
          type: 'trace_transaction',
          index: 0,
        }
      ],
    },
    1029: {
      name: "Conflux coreSpace mainnet",
      chainId: 1029,
      supported: true,
      corespace: true,
      confluxscanApi: {
        apiURL: "https://api-stage.confluxscan.org",
      },
      rpc: [
        'http://main.confluxrpc.com',
        'http://main-internal.confluxrpc.com'
      ],
      traceSupportedRPCs: [
        {
          type: 'trace_transaction',
          index: 1,
        }
      ],
    },
    1: {
      name: "Conflux coreSpace testnet",
      chainId: 1,
      supported: true,
      corespace: true,
      confluxscanApi: {
        apiURL: "https://api-testnet.confluxscan.org",
      },
      rpc: [
        'http://test.confluxrpc.com'
      ],
      traceSupportedRPCs: [
        {
          type: 'trace_transaction',
          index: 0,
        }
      ],
    },
  },
};