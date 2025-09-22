import {
  CompiledContractSource,
  CountSourcifyMatchAddresses,
  GetSourcifyMatchByChainAddressResult,
  GetSourcifyMatchByChainAddressWithPropertiesResult,
  GetSourcifyMatchesByChainResult,
  GetVerificationJobByIdResult,
  GetVerificationJobsByChainAndAddressResult,
  GetVerifiedContractByChainAndAddressResult,
  SourceInformation,
  STORED_PROPERTIES_TO_SELECTORS,
  StoredProperties,
  Tables,
} from "./Tables";
import { QueryTypes, Sequelize, Transaction } from "sequelize";
import { DatabaseOptions } from "../../config/Loader";
import { v4 as uuidv4 } from "uuid";
import IContractDeployment = Tables.IContractDeployment;
import IVerifiedContract = Tables.IVerifiedContract;
import ISourcifyMatch = Tables.ISourcifyMatch;
import { CONST } from "../../common/constants";

export class Dao {
  private readonly options: DatabaseOptions;
  private _database: Sequelize;

  constructor(options: DatabaseOptions) {
    this.options = options;
    this._database = new Sequelize(this.options);
  }

  get pool(): Sequelize {
    return this._database;
  }

  async init(): Promise<boolean> {
    await Tables.initModel(this._database);
    if (this.options.syncSchema) {
      await this._database.sync();
    }
    return true;
  }

  // =======================================================================
  // sourcify match
  // =======================================================================
  async insertSourcifyMatch(
    {
      verified_contract_id,
      runtime_match,
      creation_match,
      metadata,
      license_type,
      contract_label,
      similar_match_chain_id,
      similar_match_address,
    }: Omit<Tables.ISourcifyMatch, "created_at" | "id">,
    dbTx?: Transaction,
  ): Promise<number> {
    const metadataStr = JSON.stringify(metadata);
    const now = new Date();
    const [id, effectRows] = await this.pool.query(
      `
        INSERT INTO sourcify_matches (
        verified_contract_id,
        creation_match,
        runtime_match,
        metadata,
        license_type,
        contract_label,
        similar_match_chain_id,
        similar_match_address,
        created_at                              
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: [
          verified_contract_id,
          creation_match,
          runtime_match,
          metadataStr,
          license_type || CONST.LICENSES.None.code,
          contract_label || null,
          similar_match_chain_id || null,
          similar_match_address || null,
          now,
        ],
      },
    );

    if (effectRows) {
      return { id } as any;
    }

    const records = await this.pool.query(
      `
      SELECT
        id
      FROM sourcify_matches
      WHERE
        verified_contract_id = ?
      `,
      {
        type: QueryTypes.SELECT,
        transaction: dbTx,
        replacements: [verified_contract_id],
      },
    );

    return records[0] as any;
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
      license_type,
      contract_label,
    }: Omit<Tables.ISourcifyMatch, "created_at" | "id">,
    oldVerifiedContractId: number,
  ) {
    const metadataStr = JSON.stringify(metadata);
    return this.pool.query(
      `
        UPDATE sourcify_matches SET 
        verified_contract_id = ?,
        creation_match=?,
        runtime_match=?,
        license_type=?,
        contract_label=?,
        metadata=?
      WHERE  verified_contract_id = ?
      `,
      {
        type: QueryTypes.UPDATE,
        replacements: [
          verified_contract_id,
          creation_match,
          runtime_match,
          license_type || CONST.LICENSES.None.code,
          contract_label || null,
          metadataStr,
          oldVerifiedContractId,
        ],
      },
    );
  }

  async countSourcifyMatchAddresses(
    chain: number,
  ): Promise<CountSourcifyMatchAddresses | null> {
    const records = await this.pool.query(
      `
        SELECT
        contract_deployments.chain_id,
        CAST(SUM(CASE 
          WHEN COALESCE(sourcify_matches.creation_match, '') = 'perfect' OR sourcify_matches.runtime_match = 'perfect' THEN 1 ELSE 0 END) AS INTEGER) AS full_total,
        CAST(SUM(CASE 
          WHEN COALESCE(sourcify_matches.creation_match, '') != 'perfect' AND sourcify_matches.runtime_match != 'perfect' THEN 1 ELSE 0 END) AS INTEGER) AS partial_total
        FROM sourcify_matches
        JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
        JOIN contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
        WHERE contract_deployments.chain_id = ?
        GROUP BY contract_deployments.chain_id;
        `,
      {
        type: QueryTypes.SELECT,
        replacements: [chain],
      },
    );

    return records?.length ? (records[0] as CountSourcifyMatchAddresses) : null;
  }

  async getSourcifyMatchesByChain(
    chain: number,
    limit: number,
    descending: boolean,
    afterId?: string,
    addresses?: string[],
  ): Promise<GetSourcifyMatchesByChainResult[]> {
    const values: { [key: string]: number | string | string[] } = {
      chain,
      limit,
    };
    const orderBy = descending
      ? "ORDER BY sourcify_matches.id DESC"
      : "ORDER BY sourcify_matches.id ASC";

    let queryWhere = "";
    if (afterId) {
      values.afterId = afterId;
      queryWhere = descending
        ? "WHERE sourcify_matches.id < :afterId"
        : "WHERE sourcify_matches.id > :afterId";
    }

    if (addresses?.length) {
      values.addresses = addresses;
      queryWhere = queryWhere
        ? `${queryWhere} AND contract_deployments.address IN (:addresses)`
        : `WHERE contract_deployments.address IN (:addresses)`;
    }

    const selectors = [
      STORED_PROPERTIES_TO_SELECTORS["id"],
      STORED_PROPERTIES_TO_SELECTORS["creation_match"],
      STORED_PROPERTIES_TO_SELECTORS["runtime_match"],
      STORED_PROPERTIES_TO_SELECTORS["address"],
      STORED_PROPERTIES_TO_SELECTORS["verified_at"],
    ];
    const records = await this.pool.query(
      `
        SELECT
          ${selectors.join(", ")}
        FROM sourcify_matches
        JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
        JOIN contract_deployments ON 
            contract_deployments.id = verified_contracts.deployment_id
            AND contract_deployments.chain_id = :chain
        ${queryWhere}
        ${orderBy}
        LIMIT :limit
      `,
      {
        type: QueryTypes.SELECT,
        replacements: values,
      },
    );

    return records as GetSourcifyMatchesByChainResult[];
  }

  async getSourcifyMatchByChainAddress(
    chain: number,
    address: string,
    onlyPerfectMatches: boolean = false,
  ): Promise<GetSourcifyMatchByChainAddressResult | null> {
    const records = await this.pool.query(
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
          CONVERT(onchain_runtime_code.code USING utf8) AS onchain_runtime_code
        FROM sourcify_matches
        JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
        JOIN compiled_contracts ON compiled_contracts.id = verified_contracts.compilation_id
        JOIN contract_deployments ON 
          contract_deployments.id = verified_contracts.deployment_id 
          AND contract_deployments.chain_id = ? 
          AND contract_deployments.address = ?
        JOIN contracts ON contracts.id = contract_deployments.contract_id
        JOIN code as onchain_runtime_code ON onchain_runtime_code.code_hash = contracts.runtime_code_hash
        ${
          onlyPerfectMatches
            ? "WHERE sourcify_matches.creation_match = 'perfect' OR sourcify_matches.runtime_match = 'perfect'"
            : ""
        }
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [chain, address],
      },
    );

    return records?.length
      ? (records[0] as GetSourcifyMatchByChainAddressResult)
      : null;
  }

  async getSourcifyMatchByChainAddressWithProperties(
    chain: number,
    address: string,
    properties: StoredProperties[],
  ): Promise<GetSourcifyMatchByChainAddressWithPropertiesResult | null> {
    if (properties.length === 0) {
      throw new Error("No properties specified");
    }

    const selectors = properties.map(
      (property) => STORED_PROPERTIES_TO_SELECTORS[property],
    );

    const records = await this.pool.query(
      `
        SELECT
          ${selectors.join(", ")}
        FROM sourcify_matches
        JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
        JOIN compiled_contracts ON compiled_contracts.id = verified_contracts.compilation_id
        JOIN contract_deployments ON 
          contract_deployments.id = verified_contracts.deployment_id 
          AND contract_deployments.chain_id = ? 
          AND contract_deployments.address = ?
        JOIN contracts ON contracts.id = contract_deployments.contract_id
        LEFT JOIN code AS onchain_runtime_code ON onchain_runtime_code.code_hash = contracts.runtime_code_hash
        LEFT JOIN code AS onchain_creation_code ON onchain_creation_code.code_hash = contracts.creation_code_hash
        LEFT JOIN code AS recompiled_runtime_code ON recompiled_runtime_code.code_hash = compiled_contracts.runtime_code_hash
        LEFT JOIN code AS recompiled_creation_code ON recompiled_creation_code.code_hash = compiled_contracts.creation_code_hash
        ${
          properties.includes("sources") ||
          properties.includes("std_json_input")
            ? `JOIN compiled_contracts_sources ON compiled_contracts_sources.compilation_id = compiled_contracts.id
              LEFT JOIN sources ON sources.source_hash = compiled_contracts_sources.source_hash
              GROUP BY sourcify_matches.id, 
                verified_contracts.id, 
                compiled_contracts.id, 
                contract_deployments.id,
                contracts.id, 
                onchain_runtime_code.code_hash, 
                onchain_creation_code.code_hash,
                recompiled_runtime_code.code_hash,
                recompiled_creation_code.code_hash`
            : ""
        }
        `,
      {
        type: QueryTypes.SELECT,
        replacements: [chain, address],
      },
    );

    return records?.length
      ? (records[0] as GetSourcifyMatchByChainAddressWithPropertiesResult)
      : null;
  }

  async getSourcifyMatchAddressesByChainAndMatch(
    chain: number,
    match: "full_match" | "partial_match" | "any_match",
    page: number,
    paginationSize: number,
    descending: boolean = false,
  ): Promise<{ address: string }[]> {
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

    const records = await this.pool.query(
      `
        SELECT
          contract_deployments.address as address
        FROM sourcify_matches
        JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
        JOIN contract_deployments ON 
            contract_deployments.id = verified_contracts.deployment_id
            AND contract_deployments.chain_id = ?
        ${queryWhere}
        ${orderBy}
        LIMIT ?, ?
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [chain, page * paginationSize, paginationSize],
      },
    );

    return records as { address: string }[];
  }

  async getSourcifyMatchByVerifiedContractId(
    verifiedId: number,
  ): Promise<ISourcifyMatch | null> {
    const records = await this.pool.query(
      `
        SELECT
          *
        FROM sourcify_matches
        WHERE verified_contract_id = ?
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [verifiedId],
      },
    );

    return records?.length ? (records[0] as ISourcifyMatch) : null;
  }

  // =======================================================================
  // verified contracts
  // =======================================================================
  async insertVerifiedContract(
    {
      compilation_id,
      deployment_id,
      creation_transformations = null,
      creation_values = null,
      runtime_transformations = null,
      runtime_values = null,
      runtime_match,
      creation_match,
      runtime_metadata_match = null,
      creation_metadata_match = null,
    }: Omit<Tables.IVerifiedContract, "id">,
    dbTx?: Transaction,
  ): Promise<Pick<Tables.IVerifiedContract, "id">> {
    const creationTransformations = creation_transformations
      ? JSON.stringify(creation_transformations)
      : null; // to json
    const creationValues = creation_values
      ? JSON.stringify(creation_values)
      : null; // to json
    const runtimeTransformations = runtime_transformations
      ? JSON.stringify(runtime_transformations)
      : null; // to json
    const runtimeValues = runtime_values
      ? JSON.stringify(runtime_values)
      : null; // to json
    const runtimeMetadataMatch = !!runtime_metadata_match;
    const creationMetadataMatch = !!creation_metadata_match;
    const now = new Date();
    const [id, effectRows] = await this.pool.query(
      `
      INSERT INTO verified_contracts (
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
        createdAt, 
        updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        compilation_id = values(compilation_id),
        deployment_id = values(deployment_id)
      `,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: [
          compilation_id,
          deployment_id,
          // transformations needs to be converted to string as a workaround:
          // arrays are not treated as jsonb types by pg module
          // then they are correctly stored as jsonb by postgresql
          creationTransformations,
          creationValues,
          runtimeTransformations,
          runtimeValues,
          runtime_match,
          creation_match,
          runtimeMetadataMatch,
          creationMetadataMatch,
          now,
          now,
        ],
      },
    );

    if (effectRows) {
      return { id } as any;
    }

    const records = await this.pool.query(
      `
      SELECT
        id
      FROM verified_contracts
      WHERE 1=1
        AND compilation_id = ?
        AND deployment_id = ?
      `,
      {
        type: QueryTypes.SELECT,
        transaction: dbTx,
        replacements: [compilation_id, deployment_id],
      },
    );

    return records[0] as any;
  }

  async getVerifiedContractByChainAndAddress(
    chain: number,
    address: string,
  ): Promise<GetVerifiedContractByChainAndAddressResult | null> {
    const records = await this.pool.query(
      `
        SELECT
          verified_contracts.*,
          contract_deployments.transaction_hash,
          contract_deployments.contract_id
        FROM verified_contracts
        JOIN contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
        WHERE contract_deployments.chain_id = ?
          AND contract_deployments.address = ?
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [chain, address],
      },
    );

    return records?.length
      ? (records[0] as GetVerifiedContractByChainAndAddressResult)
      : null;
  }

  async getVerifiedContractByContractDeploymentId(
    deploymentId: number,
  ): Promise<IVerifiedContract | null> {
    const records = await this.pool.query(
      `
        SELECT
          *
        FROM verified_contracts
        WHERE deployment_id = ?
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [deploymentId],
      },
    );

    return records?.length ? (records[0] as IVerifiedContract) : null;
  }

  // =======================================================================
  // compiled contracts
  // =======================================================================
  async insertCompiledContract(
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
    }: Omit<Tables.ICompiledContract, "id">,
    dbTx?: Transaction,
  ): Promise<Pick<Tables.ICompiledContract, "id">> {
    const compilationArtifacts = JSON.stringify(compilation_artifacts); // to json
    const compilerSettings = JSON.stringify(compiler_settings); // to json
    const creationCodeArtifacts = JSON.stringify(creation_code_artifacts); // to json
    const runtimeCodeArtifacts = JSON.stringify(runtime_code_artifacts); // to json
    const now = new Date();
    const [id, effectRows] = await this.pool.query(
      `
      INSERT INTO compiled_contracts (
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
        createdAt,
        updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) 
        ON DUPLICATE KEY UPDATE
          compiler = values(compiler),
          language = values(language),
          creation_code_hash = values(creation_code_hash),
          runtime_code_hash = values(runtime_code_hash)
      `,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: [
          compiler,
          version,
          language,
          name,
          fully_qualified_name,
          compilationArtifacts,
          compilerSettings,
          creation_code_hash,
          runtime_code_hash,
          creationCodeArtifacts,
          runtimeCodeArtifacts,
          now,
          now,
        ],
      },
    );

    if (effectRows) {
      return { id } as any;
    }

    const records = await this.pool.query(
      `
      SELECT
        id
      FROM compiled_contracts
      WHERE 1=1
        AND compiler = ?
        AND language = ?
        AND (creation_code_hash = ? OR (creation_code_hash IS NULL AND ? IS NULL))
        AND runtime_code_hash = ?
      `,
      {
        type: QueryTypes.SELECT,
        transaction: dbTx,
        replacements: [
          compiler,
          language,
          creation_code_hash,
          creation_code_hash,
          runtime_code_hash,
        ],
      },
    );

    return records[0] as any;
  }

  async insertCompiledContractsSources(
    {
      sourcesInformation,
      compilation_id,
    }: {
      sourcesInformation: SourceInformation[];
      compilation_id: number;
    },
    dbTx?: Transaction,
  ) {
    // Add newly sources
    const now = new Date();
    const sourceCodesQueryIndexes: string[] = [];
    const sourceCodesQueryValues: any[] = [];
    let sourcesResult: any[] = [];
    sourcesInformation.forEach((sourceCode) => {
      sourceCodesQueryIndexes.push(`(?,?,?,?,?)`);
      sourceCodesQueryValues.push(
        ...[
          sourceCode.source_hash_keccak,
          sourceCode.content,
          sourceCode.source_hash_keccak,
          now,
          now,
        ],
      );
      sourcesResult.push({
        source_hash: sourceCode.source_hash_keccak,
        content: sourceCode.content,
        source_hash_keccak: sourceCode.source_hash_keccak,
      });
    });
    const result = await this.pool.query(
      `
      INSERT INTO sources (
        source_hash,
        content,
        source_hash_keccak,
        createdAt,
        updatedAt
      ) VALUES ${sourceCodesQueryIndexes.join(",")}
      ON DUPLICATE KEY UPDATE
        source_hash = values(source_hash)`,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: sourceCodesQueryValues,
      },
    );
    // Fetch existing sources, effectRows < len(sourcesInformation)
    if (result[1] < sourcesInformation.length) {
      sourcesResult = await this.pool.query(
        `
        SELECT * FROM sources WHERE source_hash in (?)
        `,
        {
          type: QueryTypes.SELECT,
          transaction: dbTx,
          replacements: [
            sourcesInformation.map((source) => source.source_hash_keccak),
          ],
        },
      );
    }

    // Add recompile contract sources
    const compiledContractsSourcesQueryIndexes: string[] = [];
    const compiledContractsSourcesQueryValues: any[] = [];
    sourcesInformation.forEach((compiledContractsSource) => {
      const source = sourcesResult.find(
        (sc) =>
          sc.source_hash_keccak === compiledContractsSource.source_hash_keccak,
      );
      if (!source) {
        throw new Error(
          "Source not found while inserting compiled contracts sources",
        );
      }
      compiledContractsSourcesQueryIndexes.push(`(?,?,?,?,?)`);
      compiledContractsSourcesQueryValues.push(
        ...[
          compilation_id,
          source.source_hash_keccak,
          compiledContractsSource.path,
          now,
          now,
        ],
      );
    });
    await this.pool.query(
      `
      INSERT INTO compiled_contracts_sources (
        compilation_id,
        source_hash,
        path,
        createdAt,
        updatedAt
      ) VALUES ${compiledContractsSourcesQueryIndexes.join(",")}
      ON DUPLICATE KEY UPDATE
          compilation_id = values(compilation_id),
          path = values(path)
    `,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: compiledContractsSourcesQueryValues,
      },
    );
  }

  async getCompiledContractSources(
    compilation_id: number,
  ): Promise<CompiledContractSource[]> {
    const records = await this.pool.query(
      `
        SELECT
          compiled_contracts_sources.*,
          sources.content
        FROM compiled_contracts_sources
        LEFT JOIN sources ON sources.source_hash = compiled_contracts_sources.source_hash
        WHERE compilation_id = ?
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [compilation_id],
      },
    );

    return records as CompiledContractSource[];
  }

  // =======================================================================
  // contract deployments
  // =======================================================================
  async insertContractDeployment(
    {
      chain_id,
      address,
      transaction_hash,
      contract_id,
      block_number,
      transaction_index,
      deployer,
    }: Omit<Tables.IContractDeployment, "id">,
    dbTx?: Transaction,
  ): Promise<Pick<Tables.IContractDeployment, "id">> {
    const now = new Date();
    const [id, effectRows] = await this.pool.query(
      `
      INSERT INTO contract_deployments (
        chain_id,
        address,
        transaction_hash,
        contract_id,
        block_number,
        transaction_index,
        deployer,
        createdAt,
        updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
         chain_id = values(chain_id),
         address = values(address),
         transaction_hash = values(transaction_hash)
      `,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: [
          chain_id,
          address,
          transaction_hash || null,
          contract_id,
          block_number || null,
          transaction_index || null,
          deployer || null,
          now,
          now,
        ],
      },
    );

    if (effectRows) {
      return { id } as any;
    }

    const records = await this.pool.query(
      `
      SELECT
        id
      FROM contract_deployments
      WHERE 1=1 
        AND chain_id = ?
        AND address = ?
        AND transaction_hash = ?
        AND contract_id = ?
      `,
      {
        type: QueryTypes.SELECT,
        transaction: dbTx,
        replacements: [chain_id, address, transaction_hash, contract_id],
      },
    );

    return records[0] as any;
  }

  async updateContractDeployment({
    id,
    transaction_hash,
    block_number,
    transaction_index,
    deployer,
    contract_id,
  }: Omit<Tables.IContractDeployment, "chain_id" | "address">) {
    const result = await this.pool.query(
      `
        UPDATE contract_deployments 
         SET 
           transaction_hash = ?,
           block_number = ?,
           transaction_index = ?,
           deployer = ?,
           contract_id = ?
         WHERE id = ?
       `,
      {
        type: QueryTypes.UPDATE,
        replacements: [
          transaction_hash,
          block_number,
          transaction_index,
          deployer,
          contract_id,
          id,
        ],
      },
    );

    // effectRows
    if (result[1]) {
      return {
        id,
        transaction_hash,
        block_number,
        transaction_index,
        deployer,
        contract_id,
      } as any;
    }
  }

  async getContractDeploymentByRuntimeCodeHash(
    codeHash: string,
  ): Promise<Tables.IContractDeployment | null> {
    const records = await this.pool.query(
      `
        SELECT
          cd.*
        FROM contract_deployments cd
        JOIN contracts c ON cd.contract_id = c.id and c.runtime_code_hash = ?
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [codeHash],
      },
    );

    return records?.length ? (records[0] as IContractDeployment) : null;
  }

  async insertContract(
    {
      creation_bytecode_hash,
      runtime_bytecode_hash,
    }: Omit<Tables.IContract, "id">,
    dbTx?: Transaction,
  ): Promise<Pick<Tables.IContract, "id">> {
    const now = new Date();
    const [id, effectRows] = await this.pool.query(
      `
      INSERT INTO contracts 
          (creation_code_hash, runtime_code_hash, createdAt, updatedAt) 
      VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE 
          creation_code_hash = values(creation_code_hash), 
          runtime_code_hash = values(runtime_code_hash)
      `,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: [
          creation_bytecode_hash || null,
          runtime_bytecode_hash,
          now,
          now,
        ],
      },
    );

    if (effectRows) {
      return { id } as any;
    }

    const records = await this.pool.query(
      `
      SELECT
        id
      FROM contracts
      WHERE creation_code_hash = ? AND runtime_code_hash = ?
    `,
      {
        type: QueryTypes.SELECT,
        transaction: dbTx,
        replacements: [creation_bytecode_hash, runtime_bytecode_hash],
      },
    );

    return records[0] as any;
  }

  async insertCode(
    { bytecode_hash_keccak, bytecode }: Omit<Tables.ICode, "bytecode_hash">,
    dbTx?: Transaction,
  ): Promise<Pick<Tables.ICode, "bytecode_hash">> {
    const now = new Date();
    const result = await this.pool.query(
      `
          INSERT INTO code
              (code_hash, code, code_hash_keccak, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE code_hash = values(code_hash)
      `,
      {
        type: QueryTypes.INSERT,
        transaction: dbTx,
        replacements: [
          bytecode_hash_keccak,
          Buffer.from(bytecode, "utf-8"),
          bytecode_hash_keccak,
          now,
          now,
        ],
      },
    );

    // effectRows
    if (result[1]) {
      return { bytecode_hash: bytecode_hash_keccak } as any;
    }

    const records = await this.pool.query(
      `
        SELECT
          code_hash AS bytecode_hash
        FROM code
        WHERE code_hash = ?
      `,
      {
        type: QueryTypes.SELECT,
        transaction: dbTx,
        replacements: [bytecode_hash_keccak],
      },
    );

    return records[0] as any;
  }

  // =======================================================================
  // verification job
  // =======================================================================
  async insertVerificationJob({
    started_at,
    chain_id,
    contract_address,
    verification_endpoint,
    hardware,
  }: Pick<
    Tables.IVerificationJob,
    | "started_at"
    | "chain_id"
    | "contract_address"
    | "verification_endpoint"
    | "hardware"
  >): Promise<Pick<Tables.IVerificationJob, "id">> {
    const id = uuidv4();
    await this.pool.query(
      `
      INSERT INTO verification_jobs (
        id,                       
        started_at,
        chain_id,
        contract_address,
        verification_endpoint,
        hardware                       
      ) VALUES (?,?,?,?,?,?)
      `,
      {
        type: QueryTypes.INSERT,
        replacements: [
          id,
          started_at,
          chain_id,
          contract_address,
          verification_endpoint,
          hardware,
        ],
      },
    );
    return { id } as any;
  }

  async updateVerificationJob({
    id,
    completed_at,
    verified_contract_id,
    compilation_time,
    error_code,
    error_id,
    error_data,
  }: Pick<
    Tables.IVerificationJob,
    | "id"
    | "completed_at"
    | "verified_contract_id"
    | "compilation_time"
    | "error_code"
    | "error_id"
    | "error_data"
  >): Promise<void> {
    const errorDataStr = JSON.stringify(error_data);
    await this.pool.query(
      `
        UPDATE verification_jobs 
        SET 
          completed_at = ?,
          verified_contract_id = ?,
          compilation_time = ?,
          error_code = ?,
          error_id = ?,
          error_data = ?
        WHERE id = ?
      `,
      {
        type: QueryTypes.UPDATE,
        replacements: [
          completed_at,
          verified_contract_id,
          compilation_time,
          error_code,
          error_id,
          errorDataStr,
          id,
        ],
      },
    );
  }

  async insertVerificationJobEphemeral({
    id,
    recompiled_creation_code,
    recompiled_runtime_code,
    onchain_creation_code,
    onchain_runtime_code,
    creation_transaction_hash,
  }: Tables.IVerificationJobEphemeral): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO verification_jobs_ephemeral (
        id,
        recompiled_creation_code,
        recompiled_runtime_code,
        onchain_creation_code,
        onchain_runtime_code,
        creation_transaction_hash
      ) VALUES (?,?,?,?,?,?)
      `,
      {
        type: QueryTypes.INSERT,
        replacements: [
          id,
          recompiled_creation_code,
          recompiled_runtime_code,
          onchain_creation_code,
          onchain_runtime_code,
          creation_transaction_hash,
        ],
      },
    );
  }

  async getVerificationJobById(
    verificationId: string,
  ): Promise<GetVerificationJobByIdResult | null> {
    const records = await this.pool.query(
      `
        SELECT
          DATE_FORMAT(verification_jobs.started_at, '%Y-%m-%d %H:%i:%s') AS started_at,
          DATE_FORMAT(verification_jobs.completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at,
          verification_jobs.chain_id,
          NULLIF(verification_jobs.contract_address, '0x') AS contract_address,
          verification_jobs.verified_contract_id,
          verification_jobs.error_code,
          verification_jobs.error_id,
          verification_jobs.error_data,
          verification_jobs.compilation_time,
          NULLIF(CONVERT(verification_jobs_ephemeral.recompiled_creation_code USING utf8), '0x') AS recompiled_creation_code,
          NULLIF(CONVERT(verification_jobs_ephemeral.recompiled_runtime_code USING utf8), '0x') AS recompiled_runtime_code,
          NULLIF(CONVERT(verification_jobs_ephemeral.onchain_creation_code USING utf8), '0x') AS onchain_creation_code,
          NULLIF(CONVERT(verification_jobs_ephemeral.onchain_runtime_code USING utf8), '0x') AS onchain_runtime_code,
          NULLIF(verification_jobs_ephemeral.creation_transaction_hash, '0x') AS creation_transaction_hash,
          verified_contracts.runtime_match,
          verified_contracts.creation_match,
          verified_contracts.runtime_metadata_match,
          verified_contracts.creation_metadata_match,
          sourcify_matches.id as match_id,
          DATE_FORMAT(sourcify_matches.created_at, '%Y-%m-%d %H:%i:%s') AS verified_at
        FROM verification_jobs
        LEFT JOIN verification_jobs_ephemeral ON verification_jobs.id = verification_jobs_ephemeral.id
        LEFT JOIN verified_contracts ON verification_jobs.verified_contract_id = verified_contracts.id
        LEFT JOIN sourcify_matches ON verified_contracts.id = sourcify_matches.verified_contract_id
        WHERE verification_jobs.id = ?
      `,
      {
        type: QueryTypes.SELECT,
        replacements: [verificationId],
      },
    );
    return records?.length
      ? (records[0] as GetVerificationJobByIdResult)
      : null;
  }

  async getVerificationJobsByChainAndAddress(
    chainId: number,
    address: string,
  ): Promise<GetVerificationJobsByChainAndAddressResult[]> {
    const records = await this.pool.query(
      `
      SELECT
        id,
        DATE_FORMAT(verification_jobs.completed_at, '%Y-%m-%dT%H:%i:%sT') AS completed_at
      FROM verification_jobs
      WHERE verification_jobs.chain_id = ?
        AND verification_jobs.contract_address = ?
     `,
      {
        type: QueryTypes.SELECT,
        replacements: [chainId, address],
      },
    );
    return records as GetVerificationJobsByChainAndAddressResult[];
  }
}
