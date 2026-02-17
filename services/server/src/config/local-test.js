const {
  WStorageIdentifiers,
  RWStorageIdentifiers,
} = require("../server/services/storageServices/identifiers");

module.exports = {
  verifyDeprecated: true,
  repositoryV1: {
    path: "/tmp/repositoryV1-test/",
  },
  repositoryV2: {
    path: "/tmp/repositoryV2-test/",
  },
  storage: {
    read: RWStorageIdentifiers.SourcifyDatabase,
    writeOrWarn: [WStorageIdentifiers.S3Repository],
    writeOrErr: [RWStorageIdentifiers.SourcifyDatabase],
  },
};
