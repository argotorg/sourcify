const {
  WStorageIdentifiers,
  RWStorageIdentifiers,
} = require("../server/services/storageServices/identifiers");

module.exports = {
  serverUrl: "http://localhost:5555",
  server: {
    port: 5555,
    maxFileSize: 30 * 1024 * 1024, // 30 MB
  },
  // The storage services where the verified contract be saved and read from
  storage: {
    // read option will be the "source of truth" where the contracts read from for the API requests.
    read: RWStorageIdentifiers.SourcifyDatabase,
    // User request will NOT fail if saving to these fail, but only log a warning
    writeOrWarn: [],
    // The user request will fail if saving to these fail
    writeOrErr: [RWStorageIdentifiers.SourcifyDatabase],
  },
  // Legacy repository
  repositoryV1: {
    path: "/tmp/sourcify/repository",
  },
  repositoryV2: {
    path: "/tmp/sourcify/repositoryV2",
  },
  solcRepo: "/tmp/solc-bin/linux-amd64",
  solJsonRepo: "/tmp/solc-bin/soljson",
  vyperRepo: "/tmp/vyper-bin",
  session: {
    secret: process.env.SESSION_SECRET || "CHANGE_ME",
    maxAge: 12 * 60 * 60 * 1000, // 12 hrs in millis
    secure: false, // Set Secure in the Set-Cookie header i.e. require https
    // Where to save session data. Options: "memory" | "database"
    // - "memory": Sessions stored in server memory. Only use for testing/local development.
    //   Sessions are lost when server restarts.
    // - "database": Sessions stored in PostgreSQL. Recommended for production.
    //   Requires database setup (see Database section) and uses the `session` table.
    storeType: "memory",
  },
  // If true, downloads all production version compilers and saves them.
  initCompilers: false,
  corsAllowedOrigins: [
    /^https?:\/\/(?:.+\.)?sourcify.dev$/, // sourcify.dev and subdomains
    /^https?:\/\/(?:.+\.)?sourcify.eth$/, // sourcify.eth and subdomains
    /^https?:\/\/(?:.+\.)?sourcify.eth.link$/, // sourcify.eth.link and subdomains
    /^https?:\/\/(?:.+\.)?ipfs.dweb.link$/, // dweb links used by Brave browser etc.
    process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(?::\d+)?$/, // localhost on any port
    process.env.NODE_ENV !== "production" &&
      /^https?:\/\/192\.168(?:\.\d{1,3}){2}(?::\d+)?$/, // local IPs with 192.168.x.x
    process.env.NODE_ENV !== "production" &&
      /^https?:\/\/10(?:\.\d{1,3}){3}(?::\d+)?$/, // local IPs with 10.x.x.x
  ],
  // verify-deprecated endpoint used in services/database/scripts.mjs. Used when recreating the DB with deprecated chains that don't have an RPC.
  verifyDeprecated: false,
  upgradeContract: false,
};
