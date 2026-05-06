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
      // RWStorageIdentifiers.RepositoryV1, // We no longer write to the repositoryV1
      WStorageIdentifiers.EtherscanVerify,
      WStorageIdentifiers.BlockscoutVerify,
      WStorageIdentifiers.RoutescanVerify,
    ],
    writeOrErr: [
      // WStorageIdentifiers.RepositoryV2, // We no longer write to the repositoryV2
      RWStorageIdentifiers.SourcifyDatabase,
    ],
  },
  // repositoryV1: {
  //   path: "/home/app/data/repository",
  // },
  // repositoryV2: {
  //   path: "/home/app/data/repositoryV2",
  // },
  solcRepo: "/home/app/data/compilers/solc",
  solJsonRepo: "/home/app/data/compilers/soljson",
  vyperRepo: "/home/app/data/compilers/vyper",
  feRepo: "/home/app/data/compilers/fe",
  replaceContract: true,
  brownoutV1: {
    enabled: true,
    windows: [
      // Week 1-2: 1h weekly
      { start: "2026-05-12T14:00:00Z", end: "2026-05-12T15:00:00Z" },
      { start: "2026-05-19T14:00:00Z", end: "2026-05-19T15:00:00Z" },
      // Week 3-4: 4h weekly
      { start: "2026-05-26T14:00:00Z", end: "2026-05-26T18:00:00Z" },
      { start: "2026-06-02T14:00:00Z", end: "2026-06-02T18:00:00Z" },
      // Week 5-6: 8h weekly
      { start: "2026-06-09T10:00:00Z", end: "2026-06-09T18:00:00Z" },
      { start: "2026-06-16T10:00:00Z", end: "2026-06-16T18:00:00Z" },
      // Week 7-8: 24h weekly
      { start: "2026-06-23T00:00:00Z", end: "2026-06-24T00:00:00Z" },
      { start: "2026-06-30T00:00:00Z", end: "2026-07-01T00:00:00Z" },
      // Week 9+: permanent shutdown
      { start: "2026-07-07T00:00:00Z", end: "2027-01-08T00:00:00Z" },
    ],
  },
};
