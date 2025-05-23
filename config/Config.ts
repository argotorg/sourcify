export default {
  server:{
    port: 17651,
    maxFileSize: 30 * 1024 * 1024, // 30 MB
  },
  solc:{
    solcBinRepo: '/tmp/solc-repo/bin',
    solcJsRepo: '/tmp/solc-repo/js',
  },
  mysql: {
    host: '',
    port: 3306,
    username: '',
    password: '',
    database: '',
    dialect: 'mysql',
    syncSchema: false,
    readonly : true,
    logging: false,
  },
  chains: {
    1030: {
      name: "Conflux eSpace mainnet",
      chainId: 1030,
      rpc: [
        'http://evm.confluxrpc.com'
      ],
      supported: true,
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
      rpc: [
        'http://evmtestnet.confluxrpc.com'
      ],
      supported: true,
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
      rpc: [
        'http://main.confluxrpc.com'
      ],
      supported: true,
      confluxSupported: true,
      traceSupportedRPCs: [
        {
          type: 'trace_transaction',
          index: 0,
        }
      ],
    },
    1: {
      name: "Conflux coreSpace testnet",
      chainId: 1,
      rpc: [
        'http://test.confluxrpc.com'
      ],
      supported: true,
      confluxSupported: true,
      traceSupportedRPCs: [
        {
          type: 'trace_transaction',
          index: 0,
        }
      ],
    },
  },
};