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
  session: {
    storeType: "database",
  },
  storage: {
    read: RWStorageIdentifiers.SourcifyDatabase,
    writeOrWarn: [
      RWStorageIdentifiers.RepositoryV1,
      WStorageIdentifiers.S3Repository,
    ],
    writeOrErr: [
      WStorageIdentifiers.RepositoryV2,
      RWStorageIdentifiers.SourcifyDatabase,
    ],
  },
};
