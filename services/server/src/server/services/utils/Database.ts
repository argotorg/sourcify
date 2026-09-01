import type { PoolClient, QueryResult } from "pg";
import { Pool } from "pg";
import type { Bytes, BytesKeccak } from "../../types";
import type {
  GetSourcifyMatchByChainAddressResult,
  GetSourcifyMatchByChainAddressWithPropertiesResult,
  GetSourcifyMatchesByChainResult,
  GetVerificationJobByIdResult,
  GetVerifiedContractByChainAndAddressResult,
  GetVerificationJobsByChainAndAddressResult,
  SourceInformation,
  StoredProperties,
  Tables,
  GetSourcifyMatchesAllChainsResult,
  ExternalVerification,
  CodePrefixMatchResult,
  GetCompilationsByIdsResult,
} from "./database-util";
import {
  bytesFromString,
  buildStdJsonInputSelector,
  SIMILARITY_PREFIX_LENGTH_BYTES,
  STORED_PROPERTIES_TO_SELECTORS,
} from "./database-util";
import { createHash } from "crypto";
import { AuthTypes, Connector } from "@google-cloud/cloud-sql-connector";
import logger from "../../../common/logger";
import { ConflictError } from "../../../common/errors/ConflictError";
import type { EtherscanVerifyApiIdentifiers } from "../storageServices/EtherscanVerifyApiService";

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

  async close(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = undefined;
    }
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
          compiled_contracts.version,
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
        LEFT JOIN ${this.schema}.compiled_contracts_signatures ON compiled_contracts_signatures.compilation_id = compiled_contracts.id
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
   * Returns the ids of up to `limit` compilations whose runtime code shares its
   * first 75 bytes with the given bytecode.
   *
   * Reads the compiled_contracts_runtime_code_prefixes side table: there every
   * entry is a candidate, so the LIMIT short-circuits after ~limit index
   * entries. A prefix scan on the code table is too slow -- see the analysis in
   * https://github.com/argotorg/sourcify/issues/2891.
   *
   * The LATERAL keeps only compilations that still have a sourcify_match;
   * compilations without one are stale. Do NOT rewrite it as EXISTS: Postgres
   * de-correlates EXISTS into a semi-join and drives the query from sequential
   * scans over verified_contracts and sourcify_matches (see the issue). The
   * LIMIT 1 inside the LATERAL blocks that, so the planner drives from the
   * prefix index.
   */
  async getCompilationsByRuntimeCodePrefix(
    runtimeBytecode: Buffer,
    limit: number = 20,
  ): Promise<QueryResult<CodePrefixMatchResult>> {
    return await this.pool.query(
      `
        SELECT prefixes.compilation_id
        FROM ${this.schema}.compiled_contracts_runtime_code_prefixes prefixes
        CROSS JOIN LATERAL (
          SELECT 1
          FROM ${this.schema}.verified_contracts
          JOIN ${this.schema}.sourcify_matches ON sourcify_matches.verified_contract_id = verified_contracts.id
          WHERE verified_contracts.compilation_id = prefixes.compilation_id
          LIMIT 1
        ) verified
        WHERE prefixes.runtime_code_prefix = substring($1::bytea FROM 1 FOR ${SIMILARITY_PREFIX_LENGTH_BYTES})
        LIMIT $2
      `,
      [runtimeBytecode, limit],
    );
  }

  /**
   * Fetches the compilation data needed to re-run a compilation, for a batch of
   * compilation ids in a single round trip.
   *
   * - Sources come from a scalar subquery instead of a JOIN + GROUP BY:
   *   metadata is a `json` column, which cannot be grouped.
   * - The LATERAL is aliased `sourcify_matches` so the shared selectors that
   *   reference sourcify_matches.metadata work verbatim.
   */
  async getCompilationsByIds(
    compilationIds: string[],
  ): Promise<QueryResult<GetCompilationsByIdsResult>> {
    const stdJsonInputSelector = buildStdJsonInputSelector(`(
        SELECT json_object_agg(compiled_contracts_sources.path, json_build_object('content', sources.content))
        FROM ${this.schema}.compiled_contracts_sources
        LEFT JOIN ${this.schema}.sources ON sources.source_hash = compiled_contracts_sources.source_hash
        WHERE compiled_contracts_sources.compilation_id = compiled_contracts.id
      )`);

    return await this.pool.query(
      `
        SELECT
          compiled_contracts.id as compilation_id,
          ${STORED_PROPERTIES_TO_SELECTORS["version"]},
          ${STORED_PROPERTIES_TO_SELECTORS["fully_qualified_name"]},
          ${STORED_PROPERTIES_TO_SELECTORS["creation_cbor_auxdata"]},
          ${STORED_PROPERTIES_TO_SELECTORS["runtime_cbor_auxdata"]},
          ${STORED_PROPERTIES_TO_SELECTORS["metadata"]},
          ${stdJsonInputSelector},
          ${STORED_PROPERTIES_TO_SELECTORS["std_json_output"]}
        FROM ${this.schema}.compiled_contracts
        LEFT JOIN ${this.schema}.code as recompiled_runtime_code ON recompiled_runtime_code.code_hash = compiled_contracts.runtime_code_hash
        LEFT JOIN ${this.schema}.code as recompiled_creation_code ON recompiled_creation_code.code_hash = compiled_contracts.creation_code_hash
        CROSS JOIN LATERAL (
          SELECT sourcify_matches.metadata
          FROM ${this.schema}.verified_contracts
          JOIN ${this.schema}.sourcify_matches ON sourcify_matches.verified_contract_id = verified_contracts.id
          WHERE verified_contracts.compilation_id = compiled_contracts.id
          LIMIT 1
        ) sourcify_matches
        WHERE compiled_contracts.id = ANY($1::uuid[])
      `,
      [compilationIds],
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
      chain_id,
    }: Omit<Tables.SourcifyMatch, "created_at" | "id">,
    poolClient?: PoolClient,
  ) {
    await (poolClient || this.pool).query(
      `INSERT INTO ${this.schema}.sourcify_matches (
        verified_contract_id,
        creation_match,
        runtime_match,
        metadata,
        chain_id
      ) VALUES ($1, $2, $3, $4, $5)`,
      [verified_contract_id, creation_match, runtime_match, metadata, chain_id],
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
      chain_id,
    }: Omit<Tables.SourcifyMatch, "created_at" | "id">,
    oldVerifiedContractId: string,
    poolClient?: PoolClient,
  ) {
    await (poolClient || this.pool).query(
      `UPDATE ${this.schema}.sourcify_matches SET
      verified_contract_id = $1,
      creation_match=$2,
      runtime_match=$3,
      metadata=$4,
      chain_id=$5
    WHERE  verified_contract_id = $6`,
      [
        verified_contract_id,
        creation_match,
        runtime_match,
        metadata,
        chain_id,
        oldVerifiedContractId,
      ],
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

    let queryCursorCondition = "";
    if (afterId) {
      queryCursorCondition = descending
        ? "AND sourcify_matches.id < $3"
        : "AND sourcify_matches.id > $3";
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
    WHERE sourcify_matches.chain_id = $1
    ${queryCursorCondition}
    ${orderBy}
    LIMIT $2
    `,
      values,
    );
  }

  async insertCode(
    poolClient: PoolClient,
    { bytecode_hash_keccak, bytecode }: Omit<Tables.Code, "bytecode_hash">,
  ): Promise<QueryResult<Pick<Tables.Code, "bytecode_hash">>> {
    let codeInsertResult = await poolClient.query(
      `INSERT INTO ${this.schema}.code (code_hash, code, code_hash_keccak)
      VALUES (digest($1::bytea, 'sha256'), $1::bytea, $2)
      ON CONFLICT ON CONSTRAINT code_pkey DO NOTHING
      RETURNING code_hash as bytecode_hash`,
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
      `INSERT INTO ${this.schema}.contracts (creation_code_hash, runtime_code_hash)
      VALUES ($1, $2)
      ON CONFLICT ON CONSTRAINT contracts_pseudo_pkey DO NOTHING
      RETURNING *`,
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
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT ON CONSTRAINT contract_deployments_pseudo_pkey DO NOTHING
      RETURNING *`,
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
      additional_input,
    }: Omit<Tables.CompiledContract, "id">,
  ): Promise<{
    result: QueryResult<Pick<Tables.CompiledContract, "id">>;
    isNewCompilation: boolean;
  }> {
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
        runtime_code_artifacts,
        additional_input
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT ON CONSTRAINT compiled_contracts_pseudo_pkey
      DO NOTHING RETURNING *
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
        additional_input,
      ],
    );

    const isNewCompilation = compiledContractsInsertResult.rows.length > 0;
    if (!isNewCompilation) {
      compiledContractsInsertResult = await poolClient.query(
        `
        SELECT
          id
        FROM ${this.schema}.compiled_contracts
        WHERE 1=1
          AND compiler = $1
          AND version = $2
          AND language = $3
          AND (creation_code_hash = $4 OR (creation_code_hash IS NULL AND $4 IS NULL))
          AND runtime_code_hash = $5
        `,
        [compiler, version, language, creation_code_hash, runtime_code_hash],
      );
    }
    return { result: compiledContractsInsertResult, isNewCompilation };
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
    const sourceCodesQuery = `
      INSERT INTO ${this.schema}.sources (
        source_hash,
        content,
        source_hash_keccak
      ) VALUES ${sourceCodesQueryIndexes.join(",")}
      ON CONFLICT ON CONSTRAINT sources_pkey 
      DO NOTHING RETURNING *`;
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

    const compiledContractsSourcesQuery = `
      INSERT INTO compiled_contracts_sources (
        compilation_id,
        source_hash,
        path
      )
      VALUES ${compiledContractsSourcesQueryIndexes.join(",")}
      ON CONFLICT ON CONSTRAINT compiled_contracts_sources_pseudo_pkey DO NOTHING`;
    await poolClient.query(
      compiledContractsSourcesQuery,
      compiledContractsSourcesQueryValues,
    );
  }

  async insertCompiledContractMetadata(
    poolClient: PoolClient,
    { compilation_id, metadata }: Tables.CompiledContractMetadata,
  ) {
    // ON CONFLICT DO NOTHING keeps the first submitter's metadata when a
    // compilation is shared by several verified contracts, consistent with how
    // compiled_contracts_sources are deduplicated
    await poolClient.query(
      `INSERT INTO ${this.schema}.compiled_contracts_metadata (
        compilation_id,
        metadata
      ) VALUES ($1, $2)
      ON CONFLICT ON CONSTRAINT compiled_contracts_metadata_pkey DO NOTHING`,
      [compilation_id, metadata],
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
       ON CONFLICT ON CONSTRAINT signatures_pkey DO NOTHING`,
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
       ON CONFLICT ON CONSTRAINT compiled_contracts_signatures_pseudo_pkey DO NOTHING`,
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
    const result = await poolClient.query(
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ON CONSTRAINT verified_contracts_pseudo_pkey DO NOTHING 
       RETURNING *`,
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

    if (result.rowCount === 0) {
      throw new ConflictError(
        "A verified contract already exist for your compilation and deployment",
      );
    }

    return result;
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
      verification_jobs.external_verification,
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
}
