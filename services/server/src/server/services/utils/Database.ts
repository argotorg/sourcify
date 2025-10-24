import { Pool, PoolClient, QueryResult } from "pg";
import { Bytes, BytesKeccak } from "../../types";
import {
  bytesFromString,
  GetSourcifyMatchByChainAddressResult,
  GetSourcifyMatchByChainAddressWithPropertiesResult,
  GetSourcifyMatchesByChainResult,
  GetVerificationJobByIdResult,
  GetVerifiedContractByChainAndAddressResult,
  GetVerificationJobsByChainAndAddressResult,
  SourceInformation,
  STORED_PROPERTIES_TO_SELECTORS,
  StoredProperties,
  Tables,
  GetSourcifyMatchesAllChainsResult,
  ExternalVerification,
} from "./database-util";
import { createHash } from "crypto";
import { AuthTypes, Connector } from "@google-cloud/cloud-sql-connector";
import logger from "../../../common/logger";
import { EtherscanVerifyApiIdentifiers } from "../storageServices/EtherscanVerifyApiService";

export interface DatabaseOptions {
  googleCloudSql?: {
    instanceName: string;
    database: string;
    user: string;
    password: string;
  };
  postgres?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: {
      rejectUnauthorized: boolean;
    };
  };
  schema?: string;
  maxConnections?: number;
}

export class Database {
  private _pool?: Pool;
  private schema: string = "public";
  private googleCloudSqlInstanceName?: string;
  private googleCloudSqlUser?: string;
  private googleCloudSqlPassword?: string;
  private googleCloudSqlDatabase?: string;
  private postgresHost?: string;
  private postgresPort?: number;
  private postgresDatabase?: string;
  private postgresUser?: string;
  private postgresPassword?: string;
  private postgresSsl?: {
    rejectUnauthorized: boolean;
  };
  private maxConnections?: number;
  constructor(options: DatabaseOptions) {
    this.googleCloudSqlInstanceName = options.googleCloudSql?.instanceName;
    this.googleCloudSqlUser = options.googleCloudSql?.user;
    this.googleCloudSqlPassword = options.googleCloudSql?.password;
    this.googleCloudSqlDatabase = options.googleCloudSql?.database;
    this.postgresHost = options.postgres?.host;
    this.postgresPort = options.postgres?.port;
    this.postgresDatabase = options.postgres?.database;
    this.postgresUser = options.postgres?.user;
    this.postgresPassword = options.postgres?.password;
    this.postgresSsl = options.postgres?.ssl;
    if (options.schema) {
      this.schema = options.schema;
    }
    this.maxConnections = options.maxConnections;
  }

  get pool(): Pool {
    if (!this._pool) throw new Error("Pool not initialized!");
    return this._pool;
  }

  isPoolInitialized(): boolean {
    return this._pool != undefined;
  }

  async initDatabasePool(identifier: string): Promise<boolean> {
    // if the database is already initialized
    if (this._pool != undefined) {
      return true;
    }

    logger.debug(`Initializing database pool for ${identifier}`);

    if (this.googleCloudSqlInstanceName) {
      const connector = new Connector();
      const clientOpts = await connector.getOptions({
        instanceConnectionName: this.googleCloudSqlInstanceName,
        authType: AuthTypes.PASSWORD,
      });
      this._pool = new Pool({
        ...clientOpts,
        user: this.googleCloudSqlUser,
        database: this.googleCloudSqlDatabase,
        password: this.googleCloudSqlPassword,
        max: this.maxConnections || 15,
      });
    } else if (this.postgresHost) {
      this._pool = new Pool({
        host: this.postgresHost,
        port: this.postgresPort,
        database: this.postgresDatabase,
        user: this.postgresUser,
        password: this.postgresPassword,
        max: this.maxConnections || 15,
        ssl: this.postgresSsl,
      });
    } else {
      throw new Error("Alliance Database is disabled");
    }

    // Checking pool health before continuing
    try {
      logger.debug(`Checking database pool health for ${identifier}`);
      await this._pool.query("SELECT 1;");
    } catch (error) {
      logger.error(`Cannot connect to ${identifier}`, {
        host: this.postgresHost,
        port: this.postgresPort,
        database: this.postgresDatabase,
        user: this.postgresUser,
        error,
      });
      throw new Error(`Cannot connect to ${identifier}`);
    }

    logger.info(`${identifier} initialized`, {
      host: this.postgresHost,
      port: this.postgresPort,
      database: this.postgresDatabase,
      schema: this.schema,
    });
    return true;
  }

  async getSourcifyMatchByChainAddress(
    chain: number,
    address: Bytes,
    onlyPerfectMatches: boolean = false,
  ): Promise<QueryResult<GetSourcifyMatchByChainAddressResult>> {
    return await this.pool.query(
      `
        SELECT
          sourcify_matches.created_at,
          sourcify_matches.creation_match,
          sourcify_matches.runtime_match,
          sourcify_matches.metadata,
          verified_contracts.creation_values,
          verified_contracts.runtime_values,
          verified_contracts.compilation_id,
          compiled_contracts.runtime_code_artifacts,
          compiled_contracts.name,
          contract_deployments.transaction_hash,
          encode(onchain_runtime_code.code, 'hex') as onchain_runtime_code
        FROM ${this.schema}.sourcify_matches
        JOIN ${this.schema}.verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
        JOIN ${this.schema}.compiled_contracts ON compiled_contracts.id = verified_contracts.compilation_id
        JOIN ${this.schema}.contract_deployments ON 
          contract_deployments.id = verified_contracts.deployment_id 
          AND contract_deployments.chain_id = $1 
          AND contract_deployments.address = $2
        JOIN ${this.schema}.contracts ON contracts.id = contract_deployments.contract_id
        JOIN ${this.schema}.code as onchain_runtime_code ON onchain_runtime_code.code_hash = contracts.runtime_code_hash
${
  onlyPerfectMatches
    ? "WHERE sourcify_matches.creation_match = 'perfect' OR sourcify_matches.runtime_match = 'perfect'"
    : ""
}
      `,
      [chain, address],
    );
  }

  async getSourcifyMatchByChainAddressWithProperties(
    chain: number,
    address: Bytes,
    properties: StoredProperties[],
  ): Promise<QueryResult<GetSourcifyMatchByChainAddressWithPropertiesResult>> {
    if (properties.length === 0) {
      throw new Error("No properties specified");
    }

    const selectors = properties.map(
      (property) => STORED_PROPERTIES_TO_SELECTORS[property],
    );

    const groupByClause =
      properties.includes("sources") ||
      properties.includes("std_json_input") ||
      properties.includes("function_signatures") ||
      properties.includes("event_signatures") ||
      properties.includes("error_signatures")
        ? `GROUP BY sourcify_matches.id,
        verified_contracts.id,
        compiled_contracts.id,
        contract_deployments.id,
        contracts.id,
        onchain_runtime_code.code_hash,
        onchain_creation_code.code_hash,
        recompiled_runtime_code.code_hash,
        recompiled_creation_code.code_hash`
        : "";

    return await this.pool.query(
      `
        SELECT
          ${selectors.join(", ")}
        FROM ${this.schema}.sourcify_matches
        JOIN ${this.schema}.verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
        JOIN ${this.schema}.compiled_contracts ON compiled_contracts.id = verified_contracts.compilation_id
        JOIN ${this.schema}.contract_deployments ON 
          contract_deployments.id = verified_contracts.deployment_id 
          AND contract_deployments.chain_id = $1 
          AND contract_deployments.address = $2
        JOIN ${this.schema}.contracts ON contracts.id = contract_deployments.contract_id
        LEFT JOIN ${this.schema}.code as onchain_runtime_code ON onchain_runtime_code.code_hash = contracts.runtime_code_hash
        LEFT JOIN ${this.schema}.code as onchain_creation_code ON onchain_creation_code.code_hash = contracts.creation_code_hash
        LEFT JOIN ${this.schema}.code as recompiled_runtime_code ON recompiled_runtime_code.code_hash = compiled_contracts.runtime_code_hash
        LEFT JOIN ${this.schema}.code as recompiled_creation_code ON recompiled_creation_code.code_hash = compiled_contracts.creation_code_hash
${
  properties.includes("function_signatures") ||
  properties.includes("event_signatures") ||
  properties.includes("error_signatures")
    ? `
        JOIN ${this.schema}.compiled_contracts_signatures ON compiled_contracts_signatures.compilation_id = compiled_contracts.id
        LEFT JOIN ${this.schema}.signatures ON signatures.signature_hash_32 = compiled_contracts_signatures.signature_hash_32
      `
    : ""
}
${
  properties.includes("sources") || properties.includes("std_json_input")
    ? `
        JOIN ${this.schema}.compiled_contracts_sources ON compiled_contracts_sources.compilation_id = compiled_contracts.id
        LEFT JOIN ${this.schema}.sources ON sources.source_hash = compiled_contracts_sources.source_hash
      `
    : ""
}
        ${groupByClause}
        `,
      [chain, address],
    );
  }

  /**
   * Query for looking for all sourcify matches for a given address on all chains.
   * This is used for the /v2/contract/allChains/{address} endpoint.
   */
  async getSourcifyMatchesAllChains(
    address: Bytes,
  ): Promise<QueryResult<GetSourcifyMatchesAllChainsResult>> {
    const selectors = [
      STORED_PROPERTIES_TO_SELECTORS["id"],
      STORED_PROPERTIES_TO_SELECTORS["creation_match"],
      STORED_PROPERTIES_TO_SELECTORS["runtime_match"],
      STORED_PROPERTIES_TO_SELECTORS["address"],
      STORED_PROPERTIES_TO_SELECTORS["chain_id"],
      STORED_PROPERTIES_TO_SELECTORS["verified_at"],
    ];
    return await this.pool.query(
      `SELECT 
        ${selectors.join(", ")}
      FROM ${this.schema}.contract_deployments
      JOIN ${this.schema}.verified_contracts ON verified_contracts.deployment_id = contract_deployments.id
      JOIN ${this.schema}.sourcify_matches ON sourcify_matches.verified_contract_id = verified_contracts.id
      WHERE contract_deployments.address = $1
      `,
      [address],
    );
  }

  async getCompiledContractSources(
    compilation_id: string,
  ): Promise<
    QueryResult<
      Tables.CompiledContractsSources & Pick<Tables.Sources, "content">
    >
  > {
    return await this.pool.query(
      `
        SELECT
          compiled_contracts_sources.*,
          sources.content
        FROM ${this.schema}.compiled_contracts_sources
        LEFT JOIN ${this.schema}.sources ON sources.source_hash = compiled_contracts_sources.source_hash
        WHERE compilation_id = $1
      `,
      [compilation_id],
    );
  }

  async getVerifiedContractByChainAndAddress(
    chain: number,
    address: Bytes,
    poolClient?: PoolClient,
  ): Promise<QueryResult<GetVerifiedContractByChainAndAddressResult>> {
    return await (poolClient || this.pool).query(
      `
        SELECT
          verified_contracts.*,
          contract_deployments.transaction_hash,
          contract_deployments.contract_id
        FROM ${this.schema}.verified_contracts
        JOIN ${this.schema}.contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
        WHERE 1=1
          AND contract_deployments.chain_id = $1
          AND contract_deployments.address = $2
      `,
      [chain, address],
    );
  }

  async getCompilationIdForVerifiedContract(
    verifiedContractId: Tables.VerifiedContract["id"],
    poolClient?: PoolClient,
  ): Promise<QueryResult<Pick<Tables.VerifiedContract, "compilation_id">>> {
    return await (poolClient || this.pool).query(
      `SELECT compilation_id FROM verified_contracts WHERE id = $1`,
      [verifiedContractId],
    );
  }

  async insertSourcifyMatch(
    {
      verified_contract_id,
      runtime_match,
      creation_match,
      metadata,
    }: Omit<Tables.SourcifyMatch, "created_at" | "id">,
    poolClient?: PoolClient,
  ) {
    await (poolClient || this.pool).query(
      `INSERT INTO ${this.schema}.sourcify_matches (
        verified_contract_id,
        creation_match,
        runtime_match,
        metadata
      ) VALUES ($1, $2, $3, $4)`,
      [verified_contract_id, creation_match, runtime_match, metadata],
    );
  }

  // Update sourcify_matches to the latest (and better) match in verified_contracts,
  // you need to pass the old verified_contract_id to be updated.
  // The old verified_contracts are not deleted from the verified_contracts table.
  async updateSourcifyMatch(
    {
      verified_contract_id,
      runtime_match,
      creation_match,
      metadata,
    }: Omit<Tables.SourcifyMatch, "created_at" | "id">,
    oldVerifiedContractId: string,
    poolClient?: PoolClient,
  ) {
    await (poolClient || this.pool).query(
      `UPDATE ${this.schema}.sourcify_matches SET 
      verified_contract_id = $1,
      creation_match=$2,
      runtime_match=$3,
      metadata=$4
    WHERE  verified_contract_id = $5`,
      [
        verified_contract_id,
        creation_match,
        runtime_match,
        metadata,
        oldVerifiedContractId,
      ],
    );
  }

  async countSourcifyMatchAddresses(chain: number): Promise<
    QueryResult<
      Pick<Tables.ContractDeployment, "chain_id"> & {
        full_total: number;
        partial_total: number;
      }
    >
  > {
    return await this.pool.query(
      `
  SELECT
  contract_deployments.chain_id,
  CAST(SUM(CASE 
    WHEN COALESCE(sourcify_matches.creation_match, '') = 'perfect' OR sourcify_matches.runtime_match = 'perfect' THEN 1 ELSE 0 END) AS INTEGER) AS full_total,
  CAST(SUM(CASE 
    WHEN COALESCE(sourcify_matches.creation_match, '') != 'perfect' AND sourcify_matches.runtime_match != 'perfect' THEN 1 ELSE 0 END) AS INTEGER) AS partial_total
  FROM ${this.schema}.sourcify_matches
  JOIN ${this.schema}.verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
  JOIN ${this.schema}.contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
  WHERE contract_deployments.chain_id = $1
  GROUP BY contract_deployments.chain_id;`,
      [chain],
    );
  }

  async getSourcifyMatchesByChain(
    chain: number,
    limit: number,
    descending: boolean,
    afterId?: string,
  ): Promise<QueryResult<GetSourcifyMatchesByChainResult>> {
    const values: Array<number | string> = [chain, limit];
    const orderBy = descending
      ? "ORDER BY sourcify_matches.id DESC"
      : "ORDER BY sourcify_matches.id ASC";

    let queryWhere = "";
    if (afterId) {
      queryWhere = descending
        ? "WHERE sourcify_matches.id < $3"
        : "WHERE sourcify_matches.id > $3";
      values.push(afterId);
    }

    const selectors = [
      STORED_PROPERTIES_TO_SELECTORS["id"],
      STORED_PROPERTIES_TO_SELECTORS["creation_match"],
      STORED_PROPERTIES_TO_SELECTORS["runtime_match"],
      STORED_PROPERTIES_TO_SELECTORS["address"],
      STORED_PROPERTIES_TO_SELECTORS["verified_at"],
    ];
    return await this.pool.query(
      `
    SELECT
      ${selectors.join(", ")}
    FROM ${this.schema}.sourcify_matches
    JOIN ${this.schema}.verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
    JOIN ${this.schema}.contract_deployments ON 
        contract_deployments.id = verified_contracts.deployment_id
        AND contract_deployments.chain_id = $1
    ${queryWhere}
    ${orderBy}
    LIMIT $2
    `,
      values,
    );
  }

  async getSourcifyMatchAddressesByChainAndMatch(
    chain: number,
    match: "full_match" | "partial_match" | "any_match",
    page: number,
    paginationSize: number,
    descending: boolean = false,
  ): Promise<QueryResult<{ address: string }>> {
    let queryWhere = "";
    switch (match) {
      case "full_match": {
        queryWhere =
          "WHERE COALESCE(sourcify_matches.creation_match, '') = 'perfect' OR sourcify_matches.runtime_match = 'perfect'";
        break;
      }
      case "partial_match": {
        queryWhere =
          "WHERE COALESCE(sourcify_matches.creation_match, '') != 'perfect' AND sourcify_matches.runtime_match != 'perfect'";
        break;
      }
      case "any_match": {
        queryWhere = "";
        break;
      }
      default: {
        throw new Error("Match type not supported");
      }
    }

    const orderBy = descending
      ? "ORDER BY verified_contracts.id DESC"
      : "ORDER BY verified_contracts.id ASC";

    return await this.pool.query(
      `
    SELECT
      concat('0x',encode(contract_deployments.address, 'hex')) as address
    FROM ${this.schema}.sourcify_matches
    JOIN ${this.schema}.verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
    JOIN ${this.schema}.contract_deployments ON 
        contract_deployments.id = verified_contracts.deployment_id
        AND contract_deployments.chain_id = $1
    ${queryWhere}
    ${orderBy}
    OFFSET $2 LIMIT $3
    `,
      [chain, page * paginationSize, paginationSize],
    );
  }

  async insertCode(
    poolClient: PoolClient,
    { bytecode_hash_keccak, bytecode }: Omit<Tables.Code, "bytecode_hash">,
  ): Promise<QueryResult<Pick<Tables.Code, "bytecode_hash">>> {
    let codeInsertResult = await poolClient.query(
      `INSERT INTO ${this.schema}.code (code_hash, code, code_hash_keccak) VALUES (digest($1::bytea, 'sha256'), $1::bytea, $2) ON CONFLICT (code_hash) DO NOTHING RETURNING code_hash as bytecode_hash`,
      [bytecode, bytecode_hash_keccak],
    );

    // If there is a conflict (ie. code already exists), the response will be empty. We still need to return the object to fill other tables
    if (codeInsertResult.rows.length === 0) {
      codeInsertResult = await poolClient.query(
        `SELECT
        code_hash as bytecode_hash
      FROM ${this.schema}.code
      WHERE code_hash = digest($1::bytea, 'sha256')`,
        [bytecode],
      );
    }
    return codeInsertResult;
  }

  async insertContract(
    poolClient: PoolClient,
    {
      creation_bytecode_hash,
      runtime_bytecode_hash,
    }: Omit<Tables.Contract, "id">,
  ): Promise<QueryResult<Pick<Tables.Contract, "id">>> {
    let contractInsertResult = await poolClient.query(
      `INSERT INTO ${this.schema}.contracts (creation_code_hash, runtime_code_hash) VALUES ($1, $2) ON CONFLICT (creation_code_hash, runtime_code_hash) DO NOTHING RETURNING *`,
      [creation_bytecode_hash, runtime_bytecode_hash],
    );

    if (contractInsertResult.rows.length === 0) {
      contractInsertResult = await poolClient.query(
        `
      SELECT
        id
      FROM ${this.schema}.contracts
      WHERE creation_code_hash = $1 AND runtime_code_hash = $2
      `,
        [creation_bytecode_hash, runtime_bytecode_hash],
      );
    }
    return contractInsertResult;
  }

  async insertContractDeployment(
    poolClient: PoolClient,
    {
      chain_id,
      address,
      transaction_hash,
      contract_id,
      block_number,
      transaction_index,
      deployer,
    }: Omit<Tables.ContractDeployment, "id">,
  ): Promise<QueryResult<Pick<Tables.ContractDeployment, "id">>> {
    let contractDeploymentInsertResult = await poolClient.query(
      `INSERT INTO 
      ${this.schema}.contract_deployments (
        chain_id,
        address,
        transaction_hash,
        contract_id,
        block_number,
        transaction_index,
        deployer
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT ON CONSTRAINT contract_deployments_pseudo_pkey DO NOTHING RETURNING *`,
      [
        chain_id,
        address,
        transaction_hash,
        contract_id,
        block_number,
        transaction_index,
        deployer,
      ],
    );

    if (contractDeploymentInsertResult.rows.length === 0) {
      contractDeploymentInsertResult = await poolClient.query(
        `
      SELECT
        id
      FROM ${this.schema}.contract_deployments
      WHERE 1=1 
        AND chain_id = $1
        AND address = $2
        AND transaction_hash = $3
        AND contract_id = $4
      `,
        [chain_id, address, transaction_hash, contract_id],
      );
    }
    return contractDeploymentInsertResult;
  }

  async insertCompiledContract(
    poolClient: PoolClient,
    {
      compiler,
      version,
      language,
      name,
      fully_qualified_name,
      compilation_artifacts,
      compiler_settings,
      creation_code_hash,
      runtime_code_hash,
      creation_code_artifacts,
      runtime_code_artifacts,
    }: Omit<Tables.CompiledContract, "id">,
  ): Promise<QueryResult<Pick<Tables.CompiledContract, "id">>> {
    let compiledContractsInsertResult = await poolClient.query(
      `
      INSERT INTO ${this.schema}.compiled_contracts (
        compiler,
        version,
        language,
        name,
        fully_qualified_name,
        compilation_artifacts,
        compiler_settings,
        creation_code_hash,
        runtime_code_hash,
        creation_code_artifacts,
        runtime_code_artifacts
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (compiler, language, creation_code_hash, runtime_code_hash) DO NOTHING RETURNING *
    `,
      [
        compiler,
        version,
        language,
        name,
        fully_qualified_name,
        compilation_artifacts,
        compiler_settings,
        creation_code_hash,
        runtime_code_hash,
        creation_code_artifacts,
        runtime_code_artifacts,
      ],
    );

    if (compiledContractsInsertResult.rows.length === 0) {
      compiledContractsInsertResult = await poolClient.query(
        `
        SELECT
          id
        FROM ${this.schema}.compiled_contracts
        WHERE 1=1
          AND compiler = $1
          AND language = $2
          AND (creation_code_hash = $3 OR (creation_code_hash IS NULL AND $3 IS NULL))
          AND runtime_code_hash = $4
        `,
        [compiler, language, creation_code_hash, runtime_code_hash],
      );
    }
    return compiledContractsInsertResult;
  }

  async insertCompiledContractsSources(
    poolClient: PoolClient,
    {
      sourcesInformation,
      compilation_id,
    }: {
      sourcesInformation: SourceInformation[];
      compilation_id: string;
    },
  ) {
    const sourceCodesQueryIndexes: string[] = [];
    const sourceCodesQueryValues: any[] = [];

    // Loop through each `sourceInformation` to generate the `INSERT INTO sources` query placeholders and values
    sourcesInformation.forEach((sourceCode, sourceCodesQueryIndex) => {
      sourceCodesQueryIndexes.push(
        // `sourceCodesQueryIndex * 2` comes from the number of unique values in the insert query, `sourceCode.content` is used for the first two columns
        `(digest($${sourceCodesQueryIndex * 2 + 1}, 'sha256'), $${sourceCodesQueryIndex * 2 + 1}, $${sourceCodesQueryIndex * 2 + 2}::bytea)`,
      );
      sourceCodesQueryValues.push(sourceCode.content);
      sourceCodesQueryValues.push(sourceCode.source_hash_keccak);
    });
    const sourceCodesQuery = `INSERT INTO ${this.schema}.sources (
    source_hash,
    content,
    source_hash_keccak
  ) VALUES ${sourceCodesQueryIndexes.join(",")} ON CONFLICT (source_hash) DO NOTHING RETURNING *`;
    const sourceCodesQueryResult = await poolClient.query(
      sourceCodesQuery,
      sourceCodesQueryValues,
    );

    // If some source codes already exist, fetch their hashes from the database
    if (sourceCodesQueryResult.rows.length < sourcesInformation.length) {
      const existingSourcesQuery = `
      SELECT * 
      FROM ${this.schema}.sources
      WHERE source_hash = ANY($1::bytea[])
    `;
      const existingSourcesResult = await poolClient.query(
        existingSourcesQuery,
        [
          sourcesInformation.map((source) =>
            bytesFromString(
              createHash("sha256").update(source.content).digest("hex"),
            ),
          ),
        ],
      );
      sourceCodesQueryResult.rows = existingSourcesResult.rows;
    }

    const compiledContractsSourcesQueryIndexes: string[] = [];
    const compiledContractsSourcesQueryValues: any[] = [];

    // Loop through each `sourceInformation` to generate the query placeholders and values for the `INSERT INTO compiled_contracts_sources` query.
    // We separate these into two steps because we first need to batch insert into `sources`.
    // After that, we use the newly inserted `sources.source_hash` to perform the batch insert into `compiled_contracts_sources`.
    sourcesInformation.forEach(
      (compiledContractsSource, compiledContractsSourcesQueryIndex) => {
        compiledContractsSourcesQueryIndexes.push(
          // `sourceCodesQueryIndex * 3` comes from the number of unique values in the insert query
          `($${compiledContractsSourcesQueryIndex * 3 + 1}, $${compiledContractsSourcesQueryIndex * 3 + 2}, $${compiledContractsSourcesQueryIndex * 3 + 3})`,
        );
        compiledContractsSourcesQueryValues.push(compilation_id);
        const contentHash = createHash("sha256")
          .update(compiledContractsSource.content)
          .digest("hex");
        const source = sourceCodesQueryResult.rows.find(
          (sc) => sc.source_hash.toString("hex") === contentHash,
        );
        if (!source) {
          logger.error(
            "Source not found while inserting compiled contracts sources",
            {
              compilation_id,
              compiledContractsSource,
            },
          );
          throw new Error(
            "Source not found while inserting compiled contracts sources",
          );
        }
        compiledContractsSourcesQueryValues.push(source?.source_hash);
        compiledContractsSourcesQueryValues.push(compiledContractsSource.path);
      },
    );

    const compiledContractsSourcesQuery = `INSERT INTO compiled_contracts_sources (
    compilation_id,
    source_hash,
    path
  ) VALUES ${compiledContractsSourcesQueryIndexes.join(",")} ON CONFLICT (compilation_id, path) DO NOTHING`;
    await poolClient.query(
      compiledContractsSourcesQuery,
      compiledContractsSourcesQueryValues,
    );
  }

  async insertSignatures(
    signatures: Omit<Tables.Signatures, "signature_hash_4">[],
    poolClient?: PoolClient,
  ): Promise<void> {
    if (signatures.length === 0) {
      return;
    }

    const valueIndexes: string[] = [];
    const queryValues: (BytesKeccak | string)[] = [];

    signatures.forEach((_, index) => {
      const baseIndex = index * 2 + 1;
      valueIndexes.push(`($${baseIndex}, $${baseIndex + 1})`);
    });

    signatures.forEach(({ signature_hash_32, signature }) => {
      queryValues.push(signature_hash_32, signature);
    });

    await (poolClient || this.pool).query(
      `INSERT INTO ${this.schema}.signatures (signature_hash_32, signature) 
       VALUES ${valueIndexes.join(", ")} 
       ON CONFLICT (signature_hash_32) DO NOTHING`,
      queryValues,
    );
  }

  async insertCompiledContractSignatures(
    compilation_id: string,
    signatures: Omit<
      Tables.CompiledContractsSignatures,
      "id" | "compilation_id"
    >[],
    poolClient?: PoolClient,
  ): Promise<void> {
    if (signatures.length === 0) {
      return;
    }

    const valueIndexes: string[] = [];
    const queryValues: (BytesKeccak | string)[] = [];

    signatures.forEach((_, index) => {
      const baseIndex = index * 3 + 1;
      valueIndexes.push(
        `($${baseIndex}, $${baseIndex + 1}, $${baseIndex + 2})`,
      );
    });

    signatures.forEach(({ signature_hash_32, signature_type }) => {
      queryValues.push(compilation_id, signature_hash_32, signature_type);
    });

    await (poolClient || this.pool).query(
      `INSERT INTO ${this.schema}.compiled_contracts_signatures (compilation_id, signature_hash_32, signature_type) 
       VALUES ${valueIndexes.join(", ")} 
       ON CONFLICT (compilation_id, signature_hash_32, signature_type) DO NOTHING`,
      queryValues,
    );
  }

  async insertVerifiedContract(
    poolClient: PoolClient,
    {
      compilation_id,
      deployment_id,
      creation_transformations,
      creation_values,
      runtime_transformations,
      runtime_values,
      runtime_match,
      creation_match,
      runtime_metadata_match,
      creation_metadata_match,
    }: Omit<Tables.VerifiedContract, "id">,
  ): Promise<QueryResult<Pick<Tables.VerifiedContract, "id">>> {
    let verifiedContractsInsertResult = await poolClient.query(
      `INSERT INTO ${this.schema}.verified_contracts (
        compilation_id,
        deployment_id,
        creation_transformations,
        creation_values,
        runtime_transformations,
        runtime_values,
        runtime_match,
        creation_match,
        runtime_metadata_match,
        creation_metadata_match
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        compilation_id,
        deployment_id,
        // transformations needs to be converted to string as a workaround:
        // arrays are not treated as jsonb types by pg module
        // then they are correctly stored as jsonb by postgresql
        creation_transformations
          ? JSON.stringify(creation_transformations)
          : null,
        creation_values,
        runtime_transformations
          ? JSON.stringify(runtime_transformations)
          : null,
        runtime_values,
        runtime_match,
        creation_match,
        runtime_metadata_match,
        creation_metadata_match,
      ],
    );
    if (verifiedContractsInsertResult.rows.length === 0) {
      verifiedContractsInsertResult = await poolClient.query(
        `
        SELECT
          id
        FROM ${this.schema}.verified_contracts
        WHERE 1=1
          AND compilation_id = $1
          AND deployment_id = $2
        `,
        [compilation_id, deployment_id],
      );
    }
    return verifiedContractsInsertResult;
  }

  async getVerificationJobById(
    verificationId: string,
  ): Promise<QueryResult<GetVerificationJobByIdResult>> {
    return await this.pool.query(
      `
    SELECT
      to_char(verification_jobs.started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_at,
      to_char(verification_jobs.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at,
      verification_jobs.chain_id,
      nullif(concat('0x',encode(verification_jobs.contract_address, 'hex')), '0x') as contract_address,
      verification_jobs.verified_contract_id,
      verification_jobs.error_code,
      verification_jobs.error_id,
      verification_jobs.error_data,
      verification_jobs.compilation_time,
      nullif(concat('0x',encode(verification_jobs_ephemeral.recompiled_creation_code, 'hex')), '0x') as recompiled_creation_code,
      nullif(concat('0x',encode(verification_jobs_ephemeral.recompiled_runtime_code, 'hex')), '0x') as recompiled_runtime_code,
      nullif(concat('0x',encode(verification_jobs_ephemeral.onchain_creation_code, 'hex')), '0x') as onchain_creation_code,
      nullif(concat('0x',encode(verification_jobs_ephemeral.onchain_runtime_code, 'hex')), '0x') as onchain_runtime_code,
      nullif(concat('0x',encode(verification_jobs_ephemeral.creation_transaction_hash, 'hex')), '0x') as creation_transaction_hash,
      verified_contracts.runtime_match,
      verified_contracts.creation_match,
      verified_contracts.runtime_metadata_match,
      verified_contracts.creation_metadata_match,
      sourcify_matches.id as match_id,
      to_char(sourcify_matches.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as verified_at
    FROM ${this.schema}.verification_jobs
    LEFT JOIN ${this.schema}.verification_jobs_ephemeral ON verification_jobs.id = verification_jobs_ephemeral.id
    LEFT JOIN ${this.schema}.verified_contracts ON verification_jobs.verified_contract_id = verified_contracts.id
    LEFT JOIN ${this.schema}.sourcify_matches ON verified_contracts.id = sourcify_matches.verified_contract_id
    WHERE verification_jobs.id = $1
    `,
      [verificationId],
    );
  }

  async getVerificationJobsByChainAndAddress(
    chainId: string,
    address: Bytes,
  ): Promise<QueryResult<GetVerificationJobsByChainAndAddressResult>> {
    return await this.pool.query(
      `
    SELECT
      to_char(verification_jobs.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at
    FROM ${this.schema}.verification_jobs
    WHERE verification_jobs.chain_id = $1
      AND verification_jobs.contract_address = $2
    `,
      [chainId, address],
    );
  }

  async insertVerificationJob({
    started_at,
    chain_id,
    contract_address,
    verification_endpoint,
    hardware,
  }: Pick<
    Tables.VerificationJob,
    | "started_at"
    | "chain_id"
    | "contract_address"
    | "verification_endpoint"
    | "hardware"
  >): Promise<QueryResult<Pick<Tables.VerificationJob, "id">>> {
    return await this.pool.query(
      `INSERT INTO ${this.schema}.verification_jobs (
        started_at,
        chain_id,
        contract_address,
        verification_endpoint,
        hardware
      ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [started_at, chain_id, contract_address, verification_endpoint, hardware],
    );
  }

  async updateVerificationJob(
    {
      id,
      completed_at,
      verified_contract_id,
      compilation_time,
      error_code,
      error_id,
      error_data,
    }: Pick<
      Tables.VerificationJob,
      | "id"
      | "completed_at"
      | "verified_contract_id"
      | "compilation_time"
      | "error_code"
      | "error_id"
      | "error_data"
    >,
    poolClient?: PoolClient,
  ): Promise<void> {
    await (poolClient || this.pool).query(
      `UPDATE ${this.schema}.verification_jobs 
      SET 
        completed_at = $2,
        verified_contract_id = $3,
        compilation_time = $4,
        error_code = $5,
        error_id = $6,
        error_data = $7
      WHERE id = $1`,
      [
        id,
        completed_at,
        verified_contract_id,
        compilation_time,
        error_code,
        error_id,
        error_data,
      ],
    );
  }

  async upsertExternalVerification(
    verificationJobId: Tables.VerificationJob["id"],
    verifierIdentifier: EtherscanVerifyApiIdentifiers,
    data: ExternalVerification,
    poolClient?: PoolClient,
  ): Promise<void> {
    const payload: {
      verificationId?: string;
      error?: string;
    } = {};

    if (data.verificationId) {
      payload.verificationId = data.verificationId;
    }
    if (data.error) {
      payload.error = data.error;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    const result = await (poolClient || this.pool).query(
      `UPDATE ${this.schema}.verification_jobs
       SET external_verification = jsonb_set(
         COALESCE(external_verification::jsonb, '{}'::jsonb),
         ARRAY[$2::text],
         $3::jsonb,
         true
       )
       WHERE id = $1`,
      [verificationJobId, verifierIdentifier, JSON.stringify(payload)],
    );

    if (result.rowCount === 0) {
      throw new Error(
        `Verification job ${verificationJobId} not found while updating external verification`,
      );
    }
  }

  async insertVerificationJobEphemeral({
    id,
    recompiled_creation_code,
    recompiled_runtime_code,
    onchain_creation_code,
    onchain_runtime_code,
    creation_transaction_hash,
  }: Tables.VerificationJobEphemeral): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.verification_jobs_ephemeral (
        id,
        recompiled_creation_code,
        recompiled_runtime_code,
        onchain_creation_code,
        onchain_runtime_code,
        creation_transaction_hash
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        recompiled_creation_code,
        recompiled_runtime_code,
        onchain_creation_code,
        onchain_runtime_code,
        creation_transaction_hash,
      ],
    );
  }

  async deleteMatch(
    poolClient: PoolClient,
    chainId: number | string,
    address: string,
  ): Promise<void> {
    // Safely deletes an existing sourcify match together with all dangling linked rows.
    // If any of the rows are still referenced elsewhere, the FK constraints will abort the
    // transaction and propagate an error, allowing the caller to handle it.

    const addressBytes = bytesFromString(address)!;

    // 1. Fetch all ids / hashes we may need later in the cleanup
    const { rows } = await poolClient.query(
      `
        SELECT
          vc.id  AS verified_contract_id,
          vc.compilation_id,
          vc.deployment_id,
          cd.contract_id,
          ctr.creation_code_hash  AS contract_creation_code_hash,
          ctr.runtime_code_hash   AS contract_runtime_code_hash,
          cc.creation_code_hash   AS compilation_creation_code_hash,
          cc.runtime_code_hash    AS compilation_runtime_code_hash
        FROM ${this.schema}.verified_contracts vc
        JOIN ${this.schema}.sourcify_matches sm ON sm.verified_contract_id = vc.id
        JOIN ${this.schema}.contract_deployments cd ON cd.id = vc.deployment_id
        JOIN ${this.schema}.contracts ctr          ON ctr.id = cd.contract_id
        JOIN ${this.schema}.compiled_contracts cc  ON cc.id = vc.compilation_id
        WHERE cd.chain_id = $1
          AND cd.address   = $2
        LIMIT 1;
        `,
      [chainId, addressBytes],
    );

    if (rows.length === 0) {
      throw new Error("No existing verified contract found to delete");
    }

    const info = rows[0];

    // 2. Child-first deletions relying on FK safety
    await poolClient.query(
      `DELETE FROM ${this.schema}.sourcify_matches WHERE verified_contract_id = $1`,
      [info.verified_contract_id],
    );
    await poolClient.query(
      `UPDATE ${this.schema}.verification_jobs SET verified_contract_id=NULL WHERE verified_contract_id = $1`,
      [info.verified_contract_id],
    );
    await poolClient.query(
      `DELETE FROM ${this.schema}.verified_contracts WHERE id = $1`,
      [info.verified_contract_id],
    );

    // 3. Compilation side clean-up
    const { rows: sourceRows } = await poolClient.query(
      `SELECT source_hash FROM ${this.schema}.compiled_contracts_sources WHERE compilation_id = $1`,
      [info.compilation_id],
    );
    await poolClient.query(
      `DELETE FROM ${this.schema}.compiled_contracts_sources WHERE compilation_id = $1`,
      [info.compilation_id],
    );
    await poolClient.query(
      `DELETE FROM ${this.schema}.compiled_contracts WHERE id = $1`,
      [info.compilation_id],
    );
    for (const { source_hash } of sourceRows) {
      await poolClient.query(
        `DELETE FROM ${this.schema}.sources
           WHERE source_hash = $1`,
        [source_hash],
      );
    }

    // 4. Deployment side clean-up
    await poolClient.query(
      `DELETE FROM ${this.schema}.contract_deployments WHERE id = $1`,
      [info.deployment_id],
    );
    await poolClient.query(
      `DELETE FROM ${this.schema}.contracts WHERE id = $1`,
      [info.contract_id],
    );

    // 5. Remove now-dangling code rows
    const codeHashes: Buffer[] = [
      info.contract_creation_code_hash,
      info.contract_runtime_code_hash,
      info.compilation_creation_code_hash,
      info.compilation_runtime_code_hash,
    ].filter(Boolean);

    for (const hash of codeHashes) {
      await poolClient.query(
        `DELETE FROM ${this.schema}.code WHERE code_hash = $1`,
        [hash],
      );
    }
  }
}
