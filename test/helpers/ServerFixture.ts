import { resetDatabase } from "./helpers";
import { Server } from "../../server";
import { SolcLocal } from "../../services/compiler/SolcLocal";
import { loadConfig } from "../../config/Loader";
import { ChainMap } from "../../server";
import { Chain } from "../../services/chain/Chain";
import { Sequelize } from "sequelize";

export type ServerFixtureOptions = {
  port: number
  skipDatabaseReset: boolean
}

export class ServerFixture {
  private _server?: Server

  // Getters for type safety
  // Can be safely accessed in "it" blocks
  get sourcifyDatabase(): Sequelize {
    const _sourcifyDatabase = this.server.services.store.database.pool

    if (!_sourcifyDatabase)
      throw new Error("sourcifyDatabase not initialized!")

    return _sourcifyDatabase
  }
  get server(): Server {
    if (!this._server)
      throw new Error("server not initialized!")

    return this._server
  }

  /**
   * Creates a server instance for testing with the specified configuration.
   * Expected to be called in a "describe" block.
   * Any tests that may need a different server configuration can be written
   * in a different "describe" block.
   */
  constructor(fixtureOptions_?: Partial<ServerFixtureOptions>) {
    before(async () => {
      const config = loadConfig()
      const solc = new SolcLocal(config.solc.solcBinRepo, config.solc.solcJsRepo)
      const chainMap: ChainMap  = {}
      for (const [_, chainObj] of Object.entries(config.chains)) {
        chainMap[chainObj.chainId.toString()]= new Chain(chainObj)
      }

      this._server = new Server(
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
          concurrentVerificationsPerWorker: 1
        },
        config.mysql,
      );

      await this._server.services.init()
      await this._server.listen(() => {
        console.info(`Server listening on ${this._server.port}`)
      })
    })

    beforeEach(async () => {
      if (!fixtureOptions_?.skipDatabaseReset) {
        await resetDatabase(this.sourcifyDatabase)
        console.log("Resetting SourcifyDatabase")
      }
    })

    after(async () => {
      await this._server.shutdown()
    })
  }
}
