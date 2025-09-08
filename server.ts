import express from "express";
import http from "http";
import path from "path";
import bodyParser from "body-parser";
import { ISolidityCompiler } from "@ethereum-sourcify/lib-sourcify";
import routes from "./routes/routes";
import genericErrorHandler from "./common/errors/GenericErrorHandler";
import { Services } from "./services/services";
import { VerificationOptions } from "./services/verification/VerificationService";
import { DatabaseOptions, loadConfig } from "./config/Loader";
import { SolcLocal } from "./services/compiler/SolcLocal";
import { Chain } from "./services/chain/Chain";
import { heapDump } from "./services/utils/profile-util";
import { enableHttpProxy } from "./services/utils/util";
import fileUpload from "express-fileupload";

export type ChainMap = {
  [chainId: string]: Chain;
};

export interface ServerOptions {
  port: string | number;
  maxFileSize: number;
  chains: ChainMap;
  solc: ISolidityCompiler;
  enableProfile: boolean;
}

export class Server {
  app: express.Application;
  port: string | number;
  enableProfile: boolean;
  chains: ChainMap;
  services: Services;
  httpServer?: http.Server;

  constructor(
    options: ServerOptions,
    verificationOptions: VerificationOptions,
    databaseOptions: DatabaseOptions,
  ) {
    this.app = express();
    this.port = options.port;
    this.enableProfile = options.enableProfile;
    this.chains = options.chains;
    this.services = new Services(verificationOptions, databaseOptions);

    const handleShutdownSignal = async () => {
      await this.shutdown();
      process.exit(0);
    };
    process.on("SIGTERM", handleShutdownSignal);
    process.on("SIGINT", handleShutdownSignal);

    this.app.set("chains", this.chains);
    this.app.set("solc", options.solc);
    this.app.set("services", this.services);

    this.app.use(
      bodyParser.urlencoded({ limit: options.maxFileSize, extended: true }),
    );
    this.app.use(bodyParser.json({ limit: options.maxFileSize }));
    this.app.use(
      fileUpload({
        limits: { fileSize: options.maxFileSize },
        abortOnLimit: true,
      }),
    );
    this.app.use("/", routes);
    this.app.use(genericErrorHandler);
  }

  async listen(callback?: () => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer = this.app.listen(this.port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          if (callback) callback();
          resolve();
        }
      });
    });
  }

  async shutdown() {
    console.info("Shutting down server");
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close((error?: Error) => {
          if (error) {
            // only thrown if it was not listening
            console.error("Error closing server", error);
            resolve();
          } else {
            console.info("Server closed");
            resolve();
          }
        });
      });
    }
    // Gracefully closing all in-process verifications
    await this.services.close();
    console.info("Services closed");
  }
}

const config = loadConfig();
const solc = new SolcLocal(config.solc.solcBinRepo, config.solc.solcJsRepo);
const chainMap: ChainMap = {};
for (const chainObj of Object.values(config.chains)) {
  chainMap[chainObj.chainId.toString()] = new Chain(chainObj);
}
enableHttpProxy(config.proxy);

if (require.main === module) {
  // Start Server
  const server = new Server(
    {
      port: config.server.port,
      maxFileSize: config.server.maxFileSize,
      enableProfile: config.server.enableProfile,
      chains: chainMap,
      solc,
    },
    {
      chains: chainMap,
      solcRepoPath: config.solc.solcBinRepo,
      solJsonRepoPath: config.solc.solcJsRepo,
      vyperRepoPath: config.vyper.vyperRepo,
      workerIdleTimeout: 3000,
      concurrentVerificationsPerWorker: 1,
    },
    config.mysql,
  );

  server.services.init().then(() => {
    server
      .listen(() => {
        console.info(`Server listening on ${server.port}`);
      })
      .then();
    if (server.enableProfile) {
      const fileName = path.basename(__filename);
      const extName = path.extname(__filename);
      const tag = fileName.substring(0, fileName.length - extName.length);
      const filePath = `${path.dirname(__filename)}/${tag}`;
      heapDump(filePath).then();
    }
  });
}
