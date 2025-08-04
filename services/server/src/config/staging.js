const {
  RWStorageIdentifiers,
  WStorageIdentifiers,
} = require("../server/services/storageServices/identifiers");

module.exports = {
  serverUrl: "https://staging.sourcify.dev/server",
  server: {
    port: 80,
  },
  storage: {
    read: RWStorageIdentifiers.SourcifyDatabase,
    writeOrWarn: [
      WStorageIdentifiers.AllianceDatabase,
      WStorageIdentifiers.S3Repository,
      RWStorageIdentifiers.RepositoryV1,
    ],
    writeOrErr: [
      WStorageIdentifiers.RepositoryV2,
      RWStorageIdentifiers.SourcifyDatabase,
    ],
  },
  repositoryV1: {
    path: "/home/app/data/repository",
  },
  repositoryV2: {
    path: "/home/app/data/repositoryV2",
  },
  solcRepo: "/home/app/data/compilers/solc",
  solJsonRepo: "/home/app/data/compilers/soljson",
  vyperRepo: "/home/app/data/compilers/vyper",
  session: {
    secure: true, // Set Secure in the Set-Cookie header i.e. require https
    storeType: "database",
  },
  replaceContract: true,
};
