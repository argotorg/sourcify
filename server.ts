import express from "express";
import bodyParser from "body-parser";
import routes from "./routes/routes";
import genericErrorHandler from "./common/errors/GenericErrorHandler";
import { Services } from "./services/services";
import { VerificationOptions } from "./services/verification/VerificationService";
import { ISolidityCompiler } from "@ethereum-sourcify/lib-sourcify";
import { errorHandler as v2ErrorHandler } from "./routes/api/errors";
import { DatabaseOptions, loadConfig } from "./config/Loader";
import { Solc } from "./services/compiler/Solc";
import { Chain } from "./services/chain/Chain";
const fileUpload = require("express-fileupload");

export type ChainMap = {
  [chainId: string]: Chain;
};

export interface ServerOptions {
  port: string | number;
  maxFileSize: number;
  chains: ChainMap;
  solc: ISolidityCompiler;
}

export class Server {
  app: express.Application
  port: string | number
  chains: ChainMap
  services: Services

  constructor(
    options: ServerOptions,
    verificationOptions: VerificationOptions,
    databaseOptions: DatabaseOptions,
  ) {
    this.app = express()
    this.port = options.port
    this.chains = options.chains
    this.services = new Services(verificationOptions, databaseOptions)

    this.app.set("chains", this.chains)
    this.app.set("solc", options.solc)
    this.app.set("services", this.services)

    this.app.use(bodyParser.urlencoded({ limit: options.maxFileSize, extended: true}))
    this.app.use(bodyParser.json({ limit: options.maxFileSize }))
    this.app.use(fileUpload({ limits: { fileSize: options.maxFileSize }, abortOnLimit: true}))
    this.app.use("/", routes)
    this.app.use("/v2", v2ErrorHandler)
    this.app.use(genericErrorHandler)
  }
}

const config = loadConfig()
const solc = new Solc(config.solc.solcBinRepo, config.solc.solcJsRepo)
const chainMap: ChainMap  = {}
for (const [_, chainObj] of Object.entries(config.chains)) {
  chainMap[chainObj.chainId.toString()]= new Chain(chainObj)
}

// Start Server
const server = new Server(
  {
    port: config.server.port,
    maxFileSize: config.server.maxFileSize,
    chains: chainMap,
    solc,
  },
  {
    chains: chainMap,
    solcRepoPath: config.solc.solcBinRepo,
    solJsonRepoPath: config.solc.solcJsRepo,
    workerIdleTimeout: 30,
    concurrentVerificationsPerWorker: 5
  },
  config.mysql,
);

server.services.init().then(() => {
  server.app.listen(server.port, () => {
    console.info(`Server listening on ${server.port}`);
  });
});
