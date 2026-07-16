const {
  WStorageIdentifiers,
  RWStorageIdentifiers,
} = require("../server/services/storageServices/identifiers");

module.exports = {
  verifyDeprecated: true,
  // Enable zksolc (EraVM) verification for the test suite.
  zksolcRepo: "/tmp/zksolc-bin",
  eraSolcRepo: "/tmp/era-solc-bin",
  repositoryV1: {
    path: "/tmp/repositoryV1-test/",
  },
  repositoryV2: {
    path: "/tmp/repositoryV2-test/",
  },
  storage: {
    read: RWStorageIdentifiers.SourcifyDatabase,
    writeOrWarn: [
      RWStorageIdentifiers.RepositoryV1,
      WStorageIdentifiers.RepositoryV2,
      WStorageIdentifiers.S3Repository,
    ],
    writeOrErr: [RWStorageIdentifiers.SourcifyDatabase],
  },
};
