const {
  RWStorageIdentifiers,
  WStorageIdentifiers,
} = require("../server/services/storageServices/identifiers");

module.exports = {
  server: {
    port: 80,
  },
  repositoryV1: {
    path: "/home/app/data/repository",
  },
  repositoryV2: {
    path: "/home/app/data/repositoryV2",
  },
  // The storage services where the verified contract be saved and read from
  storage: {
    read: RWStorageIdentifiers.SourcifyDatabase,
    writeOrWarn: [],
    writeOrErr: [
      WStorageIdentifiers.RepositoryV2,
      RWStorageIdentifiers.RepositoryV1,
      RWStorageIdentifiers.SourcifyDatabase,
    ],
  },
  solcRepo: "/home/app/data/compilers/solc",
  solJsonRepo: "/home/app/data/compilers/soljson",
  vyperRepo: "/home/app/data/compilers/vyper",
  session: {
    secure: true, // Set Secure in the Set-Cookie header i.e. require https
  },
  initCompilers: true,
  verifyDeprecated: true,
};
