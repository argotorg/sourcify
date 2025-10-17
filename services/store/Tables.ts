import {
  ImmutableReferences,
  Metadata,
  VerificationStatus,
  StorageLayout,
  Transformation,
  TransformationValues,
  CompiledContractCborAuxdata,
  LinkReferences,
  VyperJsonInput,
  SolidityJsonInput,
  SolidityOutput,
  VyperOutput,
  VerificationExport,
  SolidityOutputContract,
  SoliditySettings,
  VyperSettings,
  SourcifyLibErrorData,
} from "@ethereum-sourcify/lib-sourcify";
import { Abi } from "abitype";
import {
  VerifiedContract as VerifiedContractApiObject,
  Nullable,
} from "../../routes/types";
import { keccak256 } from "ethers";
import { DataTypes, Model, Sequelize } from "sequelize";

export type JobErrorData = Omit<SourcifyLibErrorData, "chainId" | "address">;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Tables {
  export interface ICode {
    bytecode_hash: string;
    bytecode_hash_keccak: string;
    bytecode: string;
  }

  export class Code extends Model<ICode> implements ICode {
    bytecode_hash!: string;
    bytecode_hash_keccak!: string;
    bytecode!: string;
    static register(sequelize: Sequelize) {
      Code.init(
        {
          bytecode_hash: {
            type: DataTypes.CHAR(66),
            allowNull: false,
            primaryKey: true,
            field: "code_hash",
          },
          bytecode_hash_keccak: {
            type: DataTypes.CHAR(66),
            allowNull: false,
            field: "code_hash_keccak",
          },
          bytecode: {
            type: DataTypes.BLOB("medium"),
            allowNull: false,
            field: "code",
          },
        },
        {
          tableName: "code",
          sequelize,
          timestamps: true,
          indexes: [],
        },
      );
    }
  }

  export interface IContract {
    id: number;
    creation_bytecode_hash?: string;
    runtime_bytecode_hash: string;
  }
  export class Contract extends Model<IContract> implements IContract {
    id!: number;
    creation_bytecode_hash?: string;
    runtime_bytecode_hash!: string;
    static register(sequelize: Sequelize) {
      Contract.init(
        {
          id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true,
          },
          creation_bytecode_hash: {
            type: DataTypes.CHAR(66),
            field: "creation_code_hash",
          },
          runtime_bytecode_hash: {
            type: DataTypes.CHAR(66),
            field: "runtime_code_hash",
            allowNull: false,
          },
        },
        {
          tableName: "contracts",
          sequelize,
          indexes: [
            {
              name: "idx_creation_runtime_code_hash",
              unique: true,
              fields: ["creation_code_hash", "runtime_code_hash"],
            },
          ],
        },
      );
    }
  }

  export interface IContractDeployment {
    id: number;
    chain_id: number;
    address: string;
    transaction_hash?: string;
    contract_id: number;
    block_number?: number;
    transaction_index?: number;
    deployer?: string;
  }
  export class ContractDeployment
    extends Model<IContractDeployment>
    implements IContractDeployment
  {
    id!: number;
    chain_id!: number;
    address!: string;
    transaction_hash?: string;
    contract_id!: number;
    block_number?: number;
    transaction_index?: number;
    deployer?: string;
    static register(sequelize: Sequelize) {
      ContractDeployment.init(
        {
          id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true,
          },
          chain_id: { type: DataTypes.INTEGER, allowNull: false },
          address: { type: DataTypes.CHAR(42), allowNull: false },
          transaction_hash: { type: DataTypes.CHAR(66) },
          contract_id: { type: DataTypes.BIGINT, allowNull: false },
          block_number: { type: DataTypes.BIGINT },
          transaction_index: { type: DataTypes.INTEGER },
          deployer: { type: DataTypes.CHAR(66) },
        },
        {
          tableName: "contract_deployments",
          sequelize,
          indexes: [
            {
              name: "idx_chainId_address_txHash",
              unique: true,
              fields: ["chain_id", "address"],
            },
          ],
        },
      );
    }
  }

  export interface ICompiledContract {
    id: number;
    compiler: string;
    version: string;
    language: string;
    name: string;
    fully_qualified_name: string;
    compilation_artifacts: {
      abi: Nullable<Abi>;
      userdoc: Nullable<any>;
      devdoc: Nullable<any>;
      storageLayout: Nullable<StorageLayout>;
      sources: Nullable<CompilationArtifactSource>;
    };
    compiler_settings: Omit<
      SoliditySettings | VyperSettings,
      "outputSelection"
    >;
    creation_code_hash?: string;
    runtime_code_hash: string;
    creation_code_artifacts: {
      sourceMap: Nullable<string>;
      linkReferences: Nullable<LinkReferences>;
      cborAuxdata: Nullable<CompiledContractCborAuxdata>;
    };
    runtime_code_artifacts: {
      sourceMap: Nullable<string>;
      linkReferences: Nullable<LinkReferences>;
      immutableReferences: Nullable<ImmutableReferences>;
      cborAuxdata: Nullable<CompiledContractCborAuxdata>;
    };
  }
  export class CompiledContract
    extends Model<ICompiledContract>
    implements ICompiledContract
  {
    id!: number;
    compiler!: string;
    version!: string;
    language!: string;
    name!: string;
    fully_qualified_name!: string;
    compilation_artifacts!: {
      abi: Nullable<Abi>;
      userdoc: Nullable<any>;
      devdoc: Nullable<any>;
      storageLayout: Nullable<StorageLayout>;
      sources: Nullable<CompilationArtifactSource>;
    };
    compiler_settings!: Omit<
      SoliditySettings | VyperSettings,
      "outputSelection"
    >;
    creation_code_hash?: string;
    runtime_code_hash!: string;
    creation_code_artifacts!: {
      sourceMap: Nullable<string>;
      linkReferences: Nullable<LinkReferences>;
      cborAuxdata: Nullable<CompiledContractCborAuxdata>;
    };
    runtime_code_artifacts!: {
      sourceMap: Nullable<string>;
      linkReferences: Nullable<LinkReferences>;
      immutableReferences: Nullable<ImmutableReferences>;
      cborAuxdata: Nullable<CompiledContractCborAuxdata>;
    };
    static register(sequelize: Sequelize) {
      CompiledContract.init(
        {
          id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true,
          },
          compiler: { type: DataTypes.CHAR(10), allowNull: false },
          version: { type: DataTypes.CHAR(64), allowNull: false },
          language: { type: DataTypes.CHAR(10), allowNull: false },
          name: { type: DataTypes.STRING(512), allowNull: false },
          fully_qualified_name: {
            type: DataTypes.STRING(512),
            allowNull: false,
          },
          compilation_artifacts: { type: DataTypes.JSON, allowNull: false },
          compiler_settings: { type: DataTypes.JSON, allowNull: false },
          creation_code_hash: { type: DataTypes.CHAR(66), allowNull: false },
          runtime_code_hash: { type: DataTypes.CHAR(66), allowNull: false },
          creation_code_artifacts: { type: DataTypes.JSON, allowNull: false },
          runtime_code_artifacts: { type: DataTypes.JSON, allowNull: false },
        },
        {
          tableName: "compiled_contracts",
          sequelize,
          indexes: [
            {
              name: "idx_compiler_language_creationCodeHash_runtimeCodeHash",
              unique: true,
              fields: [
                "compiler",
                "language",
                "creation_code_hash",
                "runtime_code_hash",
              ],
            },
          ],
        },
      );
    }
  }

  export interface IVerifiedContract {
    id: number;
    compilation_id: number;
    deployment_id: number;
    creation_transformations: Nullable<Transformation[]>;
    creation_values: Nullable<TransformationValues>;
    runtime_transformations: Nullable<Transformation[]>;
    runtime_values: Nullable<TransformationValues>;
    runtime_match: boolean;
    creation_match: boolean;
    runtime_metadata_match: Nullable<boolean>;
    creation_metadata_match: Nullable<boolean>;
  }
  export class VerifiedContract
    extends Model<IVerifiedContract>
    implements IVerifiedContract
  {
    id!: number;
    compilation_id!: number;
    deployment_id!: number;
    creation_transformations!: Nullable<Transformation[]>;
    creation_values!: Nullable<TransformationValues>;
    runtime_transformations!: Nullable<Transformation[]>;
    runtime_values!: Nullable<TransformationValues>;
    runtime_match!: boolean;
    creation_match!: boolean;
    runtime_metadata_match!: Nullable<boolean>;
    creation_metadata_match!: Nullable<boolean>;
    static register(sequelize: Sequelize) {
      VerifiedContract.init(
        {
          id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true,
          },
          compilation_id: { type: DataTypes.INTEGER, allowNull: false },
          deployment_id: { type: DataTypes.INTEGER, allowNull: false },
          creation_transformations: { type: DataTypes.JSON },
          creation_values: { type: DataTypes.JSON },
          runtime_transformations: { type: DataTypes.JSON },
          runtime_values: { type: DataTypes.JSON },
          runtime_match: { type: DataTypes.BOOLEAN, allowNull: false },
          creation_match: { type: DataTypes.BOOLEAN, allowNull: false },
          runtime_metadata_match: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          creation_metadata_match: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
        },
        {
          tableName: "verified_contracts",
          sequelize,
          indexes: [
            {
              name: "idx_compilationId_deploymentId",
              unique: true,
              fields: ["compilation_id", "deployment_id"],
            },
          ],
        },
      );
    }
  }

  export interface ISource {
    source_hash: string;
    source_hash_keccak: string;
    content: string;
  }
  export class Source extends Model<ISource> implements ISource {
    source_hash!: string;
    source_hash_keccak!: string;
    content!: string;
    static register(sequelize: Sequelize) {
      Source.init(
        {
          source_hash: {
            type: DataTypes.CHAR(66),
            allowNull: false,
            primaryKey: true,
          },
          source_hash_keccak: { type: DataTypes.CHAR(66), allowNull: false },
          content: { type: DataTypes.BLOB("medium"), allowNull: false },
        },
        {
          tableName: "sources",
          sequelize,
          indexes: [],
        },
      );
    }
  }

  export interface ICompiledContractSource {
    id: string;
    compilation_id: string;
    source_hash: string;
    path: string;
  }
  export class CompiledContractSource
    extends Model<ICompiledContractSource>
    implements ICompiledContractSource
  {
    id!: string;
    compilation_id!: string;
    path!: string;
    source_hash!: string;
    static register(sequelize: Sequelize) {
      CompiledContractSource.init(
        {
          id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true,
          },
          compilation_id: { type: DataTypes.BIGINT, allowNull: false },
          path: { type: DataTypes.STRING(256), allowNull: false },
          source_hash: { type: DataTypes.CHAR(66), allowNull: false },
        },
        {
          tableName: "compiled_contracts_sources",
          sequelize,
          indexes: [
            {
              name: "idx_compilationId_path",
              unique: true,
              fields: ["compilation_id", "path"],
            },
          ],
        },
      );
    }
  }

  export interface ISourcifyMatch {
    id: number;
    verified_contract_id: number;
    runtime_match: Nullable<VerificationStatus>;
    creation_match: Nullable<VerificationStatus>;
    metadata: Metadata;
    license_type?: number;
    contract_label?: string;
    similar_match_chain_id?: number;
    similar_match_address?: string;
    created_at: Date;
  }
  export class SourcifyMatch
    extends Model<ISourcifyMatch>
    implements ISourcifyMatch
  {
    id!: number;
    verified_contract_id!: number;
    runtime_match!: Nullable<VerificationStatus>;
    creation_match!: Nullable<VerificationStatus>;
    metadata!: Metadata;
    license_type?: number;
    contract_label?: string;
    similar_match_chain_id?: number;
    similar_match_address?: string;
    created_at!: Date;
    static register(sequelize: Sequelize) {
      SourcifyMatch.init(
        {
          id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true,
          },
          verified_contract_id: { type: DataTypes.BIGINT, allowNull: false },
          runtime_match: { type: DataTypes.CHAR(20) },
          creation_match: { type: DataTypes.CHAR(20) },
          metadata: { type: DataTypes.JSON, allowNull: false },
          license_type: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
          },
          contract_label: { type: DataTypes.STRING(512) },
          similar_match_chain_id: { type: DataTypes.INTEGER },
          similar_match_address: { type: DataTypes.CHAR(42) },
          created_at: { type: DataTypes.DATE, allowNull: false },
        },
        {
          tableName: "sourcify_matches",
          sequelize,
          timestamps: false,
          indexes: [
            {
              name: "idx_verifiedContractId",
              unique: true,
              fields: ["verified_contract_id"],
            },
          ],
        },
      );
    }
  }

  export interface CompilationArtifactSource {
    [globalName: string]: {
      id: number;
    };
  }

  export interface IVerificationJob {
    id: string;
    started_at: Date;
    completed_at: Nullable<Date>;
    chain_id: number;
    contract_address: string;
    verified_contract_id: Nullable<number>;
    error_code: Nullable<string>;
    error_id: Nullable<string>;
    error_data: Nullable<JobErrorData>;
    verification_endpoint: string;
    hardware: Nullable<string>;
    compilation_time: Nullable<number>;
  }
  export class VerificationJob
    extends Model<IVerificationJob>
    implements IVerificationJob
  {
    id!: string;
    started_at!: Date;
    completed_at!: Nullable<Date>;
    chain_id!: number;
    contract_address!: string;
    verified_contract_id!: Nullable<number>;
    error_code!: Nullable<string>;
    error_id!: Nullable<string>;
    error_data!: Nullable<JobErrorData>;
    verification_endpoint!: string;
    hardware!: Nullable<string>;
    compilation_time!: Nullable<number>;
    static register(sequelize: Sequelize) {
      VerificationJob.init(
        {
          id: { type: DataTypes.CHAR(36), allowNull: false, primaryKey: true },
          started_at: { type: DataTypes.DATE, allowNull: false },
          completed_at: { type: DataTypes.DATE },
          chain_id: { type: DataTypes.BIGINT, allowNull: false },
          contract_address: { type: DataTypes.CHAR(66), allowNull: false },
          verified_contract_id: { type: DataTypes.BIGINT },
          error_code: { type: DataTypes.CHAR(64) },
          error_id: { type: DataTypes.CHAR(64) },
          error_data: { type: DataTypes.JSON },
          verification_endpoint: {
            type: DataTypes.CHAR(128),
            allowNull: false,
          },
          hardware: { type: DataTypes.CHAR(128) },
          compilation_time: { type: DataTypes.INTEGER },
        },
        {
          tableName: "verification_jobs",
          sequelize,
          timestamps: false,
          indexes: [
            {
              name: "idx_chainId_contractAddress",
              fields: ["chain_id", "contract_address"],
            },
          ],
        },
      );
    }
  }

  export interface IVerificationJobEphemeral {
    id: string;
    recompiled_creation_code: Nullable<string>;
    recompiled_runtime_code: Nullable<string>;
    onchain_creation_code: Nullable<string>;
    onchain_runtime_code: Nullable<string>;
    creation_transaction_hash: Nullable<string>;
  }
  export class VerificationJobEphemeral
    extends Model<IVerificationJobEphemeral>
    implements IVerificationJobEphemeral
  {
    id!: string;
    recompiled_creation_code!: Nullable<string>;
    recompiled_runtime_code!: Nullable<string>;
    onchain_creation_code!: Nullable<string>;
    onchain_runtime_code!: Nullable<string>;
    creation_transaction_hash!: Nullable<string>;
    static register(sequelize: Sequelize) {
      VerificationJobEphemeral.init(
        {
          id: { type: DataTypes.CHAR(36), allowNull: false, primaryKey: true },
          recompiled_creation_code: { type: DataTypes.BLOB("medium") },
          recompiled_runtime_code: { type: DataTypes.BLOB("medium") },
          onchain_creation_code: { type: DataTypes.BLOB("medium") },
          onchain_runtime_code: { type: DataTypes.BLOB("medium") },
          creation_transaction_hash: { type: DataTypes.CHAR(66) },
        },
        {
          tableName: "verification_jobs_ephemeral",
          sequelize,
          timestamps: false,
          indexes: [],
        },
      );
    }
  }

  export async function initModel(sequelize: Sequelize) {
    Code.register(sequelize);
    Contract.register(sequelize);
    ContractDeployment.register(sequelize);
    CompiledContract.register(sequelize);
    VerifiedContract.register(sequelize);
    Source.register(sequelize);
    CompiledContractSource.register(sequelize);
    SourcifyMatch.register(sequelize);
    VerificationJob.register(sequelize);
    VerificationJobEphemeral.register(sequelize);
  }
}

export interface SourceInformation {
  source_hash_keccak: string;
  content: string;
  path: string;
}

// This object contains all Tables fields except foreign keys generated during INSERTs
export interface DatabaseColumns {
  recompiledCreationCode?: Omit<Tables.ICode, "bytecode_hash">;
  recompiledRuntimeCode: Omit<Tables.ICode, "bytecode_hash">;
  onchainCreationCode?: Omit<Tables.ICode, "bytecode_hash">;
  onchainRuntimeCode: Omit<Tables.ICode, "bytecode_hash">;
  contractDeployment: Omit<Tables.IContractDeployment, "id" | "contract_id">;
  compiledContract: Omit<
    Tables.ICompiledContract,
    "id" | "creation_code_hash" | "runtime_code_hash"
  >;
  verifiedContract: Omit<
    Tables.IVerifiedContract,
    "id" | "compilation_id" | "deployment_id"
  >;
  sourcesInformation: SourceInformation[];
}

export type GetVerifiedContractByChainAndAddressResult =
  Tables.IVerifiedContract & {
    transaction_hash: string | null;
    contract_id: string;
  };

export type CountSourcifyMatchAddresses = Pick<
  Tables.IContractDeployment,
  "chain_id"
> & {
  full_total: number;
  partial_total: number;
};

export type GetSourcifyMatchByChainAddressResult = Tables.ISourcifyMatch &
  Pick<
    Tables.IVerifiedContract,
    "creation_values" | "runtime_values" | "compilation_id"
  > &
  Pick<Tables.ICompiledContract, "runtime_code_artifacts" | "name"> &
  Pick<Tables.IContractDeployment, "transaction_hash"> & {
    onchain_runtime_code: string;
  };

export type GetSourcifyMatchesByChainResult = Pick<
  Tables.ISourcifyMatch,
  "id" | "creation_match" | "runtime_match"
> & { address: string; verified_at: string };

export type GetSourcifyMatchByChainAddressWithPropertiesResult = Partial<
  Pick<
    Tables.ISourcifyMatch,
    | "id"
    | "creation_match"
    | "runtime_match"
    | "metadata"
    | "license_type"
    | "contract_label"
  > &
    Pick<
      Tables.ICompiledContract,
      | "language"
      | "compiler"
      | "version"
      | "compiler_settings"
      | "name"
      | "fully_qualified_name"
    > &
    Pick<
      Tables.ICompiledContract["compilation_artifacts"],
      "abi" | "userdoc" | "devdoc"
    > &
    Pick<
      Tables.IVerifiedContract,
      | "creation_transformations"
      | "creation_values"
      | "runtime_transformations"
      | "runtime_values"
    > &
    Pick<Tables.IContractDeployment, "block_number" | "transaction_index"> & {
      verified_at: string;
      address: string;
      onchain_creation_code: string;
      recompiled_creation_code: string;
      creation_source_map: Tables.ICompiledContract["creation_code_artifacts"]["sourceMap"];
      creation_link_references: Tables.ICompiledContract["creation_code_artifacts"]["linkReferences"];
      creation_cbor_auxdata: Tables.ICompiledContract["creation_code_artifacts"]["cborAuxdata"];
      onchain_runtime_code: string;
      recompiled_runtime_code: string;
      runtime_source_map: Tables.ICompiledContract["runtime_code_artifacts"]["sourceMap"];
      runtime_link_references: Tables.ICompiledContract["runtime_code_artifacts"]["linkReferences"];
      runtime_cbor_auxdata: Tables.ICompiledContract["runtime_code_artifacts"]["cborAuxdata"];
      runtime_immutable_references: Tables.ICompiledContract["runtime_code_artifacts"]["immutableReferences"];
      transaction_hash: string;
      deployer: string;
      sources: { [path: string]: { content: string } };
      storage_layout: Tables.ICompiledContract["compilation_artifacts"]["storageLayout"];
      source_ids: Tables.ICompiledContract["compilation_artifacts"]["sources"];
      std_json_input: SolidityJsonInput | VyperJsonInput;
      std_json_output: SolidityOutput | VyperOutput;
    }
>;

export type CompiledContractSource = Tables.ICompiledContractSource &
  Pick<Tables.ISource, "content">;

export type GetVerificationJobByIdResult = Pick<
  Tables.IVerificationJob,
  | "chain_id"
  | "verified_contract_id"
  | "error_code"
  | "error_id"
  | "error_data"
  | "compilation_time"
> & {
  started_at: string;
  completed_at: Nullable<string>;
  contract_address: string;
  recompiled_creation_code: Nullable<string>;
  recompiled_runtime_code: Nullable<string>;
  onchain_creation_code: Nullable<string>;
  onchain_runtime_code: Nullable<string>;
  creation_transaction_hash: Nullable<string>;
  runtime_match: Nullable<Tables.IVerifiedContract["runtime_match"]>;
  creation_match: Nullable<Tables.IVerifiedContract["creation_match"]>;
  runtime_metadata_match: Nullable<
    Tables.IVerifiedContract["runtime_metadata_match"]
  >;
  creation_metadata_match: Nullable<
    Tables.IVerifiedContract["creation_metadata_match"]
  >;
  match_id: Nullable<Tables.ISourcifyMatch["id"]>;
  verified_at: Nullable<string>;
};

export type GetVerificationJobsByChainAndAddressResult = {
  id: string;
  completed_at: Nullable<string>;
};

const sourcesAggregation =
  "json_objectagg(compiled_contracts_sources.path, json_object('content', CONVERT(sources.content USING utf8mb4)))";

export const STORED_PROPERTIES_TO_SELECTORS = {
  id: "sourcify_matches.id",
  creation_match: "sourcify_matches.creation_match",
  runtime_match: "sourcify_matches.runtime_match",
  verified_at:
    "DATE_FORMAT(sourcify_matches.created_at, '%Y-%m-%dT%H:%i:%sT') as verified_at",
  license_type: "sourcify_matches.license_type",
  contract_label: "sourcify_matches.contract_label",
  address: "nullif(contract_deployments.address, '0x') as address",
  onchain_creation_code:
    "nullif(CONVERT(onchain_creation_code.code USING utf8), '0x') as onchain_creation_code",
  recompiled_creation_code:
    "nullif(CONVERT(recompiled_creation_code.code USING utf8), '0x') as recompiled_creation_code",
  creation_source_map:
    "compiled_contracts.creation_code_artifacts->>'$.sourceMap' as creation_source_map",
  creation_link_references:
    "compiled_contracts.creation_code_artifacts->'$.linkReferences' as creation_link_references",
  creation_cbor_auxdata:
    "compiled_contracts.creation_code_artifacts->'$.cborAuxdata' as creation_cbor_auxdata",
  creation_transformations: "verified_contracts.creation_transformations",
  creation_values: "verified_contracts.creation_values",
  onchain_runtime_code:
    "nullif(CONVERT(onchain_runtime_code.code USING utf8), '0x') as onchain_runtime_code",
  recompiled_runtime_code:
    "nullif(CONVERT(recompiled_runtime_code.code USING utf8), '0x') as recompiled_runtime_code",
  runtime_source_map:
    "compiled_contracts.runtime_code_artifacts->>'$.sourceMap' as runtime_source_map",
  runtime_link_references:
    "compiled_contracts.runtime_code_artifacts->'$.linkReferences' as runtime_link_references",
  runtime_cbor_auxdata:
    "compiled_contracts.runtime_code_artifacts->'$.cborAuxdata' as runtime_cbor_auxdata",
  runtime_immutable_references:
    "compiled_contracts.runtime_code_artifacts->'$.immutableReferences' as runtime_immutable_references",
  runtime_transformations: "verified_contracts.runtime_transformations",
  runtime_values: "verified_contracts.runtime_values",
  transaction_hash:
    "nullif(contract_deployments.transaction_hash, '0x') as transaction_hash",
  block_number: "contract_deployments.block_number",
  transaction_index: "contract_deployments.transaction_index",
  deployer: "nullif(contract_deployments.deployer, '0x') as deployer",
  sources: `${sourcesAggregation} as sources`,
  language:
    "CONCAT(UPPER(LEFT(compiled_contracts.language, 1)), LOWER(SUBSTRING(compiled_contracts.language, 2))) as language",
  compiler: "compiled_contracts.compiler",
  version: "compiled_contracts.version as version",
  compiler_settings: "compiled_contracts.compiler_settings",
  name: "compiled_contracts.name",
  fully_qualified_name: "compiled_contracts.fully_qualified_name",
  abi: "compiled_contracts.compilation_artifacts->'$.abi' as abi",
  metadata: "sourcify_matches.metadata",
  storage_layout:
    "compiled_contracts.compilation_artifacts->'$.storageLayout' as storage_layout",
  userdoc: "compiled_contracts.compilation_artifacts->'$.userdoc' as userdoc",
  devdoc: "compiled_contracts.compilation_artifacts->'$.devdoc' as devdoc",
  source_ids:
    "compiled_contracts.compilation_artifacts->'$.sources' as source_ids",
  std_json_input: `json_object(
    'language', CONCAT(UPPER(LEFT(compiled_contracts.language, 1)), LOWER(SUBSTRING(compiled_contracts.language, 2))), 
    'sources', ${sourcesAggregation},
    'settings', compiled_contracts.compiler_settings
  ) as std_json_input`,
  std_json_output: `json_object(
    'sources', compiled_contracts.compilation_artifacts->'$.sources',
    'contracts', json_object(
      substring(
        compiled_contracts.fully_qualified_name, 
        1, 
        length(compiled_contracts.fully_qualified_name) - length(SUBSTRING_INDEX(compiled_contracts.fully_qualified_name, ':', -1)) - 1
      ), 
      json_object(
        SUBSTRING_INDEX(compiled_contracts.fully_qualified_name, ':', -1), json_object(
          'abi', compiled_contracts.compilation_artifacts->'$.abi',
          'metadata', CAST(sourcify_matches.metadata AS CHAR),
          'userdoc', compiled_contracts.compilation_artifacts->'$.userdoc',
          'devdoc', compiled_contracts.compilation_artifacts->'$.devdoc',
          'storageLayout', compiled_contracts.compilation_artifacts->'$.storageLayout',
          'evm', json_object(
            'bytecode', json_object(
              'object', nullif(CONVERT(recompiled_creation_code.code USING utf8), '0x'),
              'sourceMap', compiled_contracts.creation_code_artifacts->>'$.sourceMap',
              'linkReferences', compiled_contracts.creation_code_artifacts->'$.linkReferences'
            ),
            'deployedBytecode', json_object(
              'object', nullif(CONVERT(recompiled_runtime_code.code USING utf8), '0x'),
              'sourceMap', compiled_contracts.runtime_code_artifacts->>'$.sourceMap',
              'linkReferences', compiled_contracts.runtime_code_artifacts->'$.linkReferences',
              'immutableReferences', compiled_contracts.runtime_code_artifacts->'$.immutableReferences'
            )
          )
        )
      )
    )
  ) as std_json_output`,
};

export type StoredProperties = keyof typeof STORED_PROPERTIES_TO_SELECTORS;

type creationBytecodeSubfields = keyof NonNullable<
  VerifiedContractApiObject["creationBytecode"]
>;
type runtimeBytecodeSubfields = keyof NonNullable<
  VerifiedContractApiObject["runtimeBytecode"]
>;
type deploymentSubfields = keyof NonNullable<
  VerifiedContractApiObject["deployment"]
>;
type compilationSubfields = keyof NonNullable<
  VerifiedContractApiObject["compilation"]
>;
type proxyResolutionSubfields = keyof Partial<
  VerifiedContractApiObject["proxyResolution"]
>;

// used for API v2 GET contract endpoint
export const FIELDS_TO_STORED_PROPERTIES: Record<
  keyof Omit<
    VerifiedContractApiObject,
    | "chainId"
    | "address"
    | "match"
    | "creationBytecode"
    | "runtimeBytecode"
    | "deployment"
    | "compilation"
    | "proxyResolution"
  >,
  StoredProperties
> & {
  creationBytecode: Record<creationBytecodeSubfields, StoredProperties>;
  runtimeBytecode: Record<runtimeBytecodeSubfields, StoredProperties>;
  deployment: Record<deploymentSubfields, StoredProperties>;
  compilation: Record<compilationSubfields, StoredProperties>;
  proxyResolution: Record<proxyResolutionSubfields, StoredProperties>;
} = {
  matchId: "id",
  creationMatch: "creation_match",
  runtimeMatch: "runtime_match",
  verifiedAt: "verified_at",
  licenseType: "license_type",
  contractLabel: "contract_label",
  creationBytecode: {
    onchainBytecode: "onchain_creation_code",
    recompiledBytecode: "recompiled_creation_code",
    sourceMap: "creation_source_map",
    linkReferences: "creation_link_references",
    cborAuxdata: "creation_cbor_auxdata",
    transformations: "creation_transformations",
    transformationValues: "creation_values",
  },
  runtimeBytecode: {
    onchainBytecode: "onchain_runtime_code",
    recompiledBytecode: "recompiled_runtime_code",
    sourceMap: "runtime_source_map",
    linkReferences: "runtime_link_references",
    cborAuxdata: "runtime_cbor_auxdata",
    immutableReferences: "runtime_immutable_references",
    transformations: "runtime_transformations",
    transformationValues: "runtime_values",
  },
  deployment: {
    transactionHash: "transaction_hash",
    blockNumber: "block_number",
    transactionIndex: "transaction_index",
    deployer: "deployer",
  },
  sources: "sources",
  compilation: {
    language: "language",
    compiler: "compiler",
    compilerVersion: "version",
    compilerSettings: "compiler_settings",
    name: "name",
    fullyQualifiedName: "fully_qualified_name",
  },
  abi: "abi",
  metadata: "metadata",
  storageLayout: "storage_layout",
  userdoc: "userdoc",
  devdoc: "devdoc",
  sourceIds: "source_ids",
  stdJsonInput: "std_json_input",
  stdJsonOutput: "std_json_output",
  proxyResolution: {
    // TODO: remove onchainRuntimeBytecode and onchainCreationBytecode when proxy detection result is stored in database
    onchainRuntimeBytecode: "onchain_runtime_code",
    onchainCreationBytecode: "onchain_creation_code",
    isProxy: "sources",
    proxyType: "sources",
    implementations: "sources",
    proxyResolutionError: "sources",
  },
};

export type Field =
  | keyof typeof FIELDS_TO_STORED_PROPERTIES
  | `creationBytecode.${creationBytecodeSubfields}`
  | `runtimeBytecode.${runtimeBytecodeSubfields}`
  | `deployment.${deploymentSubfields}`
  | `compilation.${compilationSubfields}`;

// Use the transformations array to normalize the library transformations in both runtime and creation recompiled bytecodes
// Normalization for recompiled bytecodes means:
//   Runtime bytecode:
//     1. Replace library address placeholders ("__$53aea86b7d70b31448b230b20ae141a537$__") with zeros
//     2. Immutables are already set to zeros
//   Creation bytecode:
//     1. Replace library address placeholders ("__$53aea86b7d70b31448b230b20ae141a537$__") with zeros
//     2. Immutables are already set to zeros
export function normalizeRecompiledBytecodes(verification: VerificationExport) {
  let normalizedRuntimeBytecode = verification.compilation.runtimeBytecode;
  let normalizedCreationBytecode = verification.compilation.creationBytecode;

  const PLACEHOLDER_LENGTH = 40;
  const placeholder = "0".repeat(PLACEHOLDER_LENGTH);

  // Runtime bytecode normalzations
  verification.transformations.runtime.list.forEach((transformation) => {
    if (transformation.reason === "library" && normalizedRuntimeBytecode) {
      normalizedRuntimeBytecode = normalizedRuntimeBytecode.substring(2);
      // we multiply by 2 because transformation.offset is stored as the length in bytes
      const before = normalizedRuntimeBytecode.substring(
        0,
        transformation.offset * 2,
      );
      const after = normalizedRuntimeBytecode.substring(
        transformation.offset * 2 + PLACEHOLDER_LENGTH,
      );
      normalizedRuntimeBytecode = `0x${before + placeholder + after}`;
    }
  });

  // Creation bytecode normalizations
  verification.transformations.creation.list.forEach((transformation) => {
    if (transformation.reason === "library" && normalizedCreationBytecode) {
      normalizedCreationBytecode = normalizedCreationBytecode.substring(2);
      // we multiply by 2 because transformation.offset is stored as the length in bytes
      const before = normalizedCreationBytecode.substring(
        0,
        transformation.offset * 2,
      );
      const after = normalizedCreationBytecode.substring(
        transformation.offset * 2 + PLACEHOLDER_LENGTH,
      );
      normalizedCreationBytecode = `0x${before + placeholder + after}`;
    }
  });

  return {
    normalizedRuntimeBytecode,
    normalizedCreationBytecode,
  };
}

function getKeccak256Bytecodes(
  verification: VerificationExport,
  normalizedCreationBytecode: string | undefined,
  normalizedRuntimeBytecode: string | undefined,
) {
  if (normalizedRuntimeBytecode === undefined) {
    throw new Error("normalizedRuntimeBytecode cannot be undefined");
  }
  if (verification.onchainRuntimeBytecode === undefined) {
    throw new Error("onchainRuntimeBytecode cannot be undefined");
  }

  return {
    keccak256OnchainCreationBytecode: verification.onchainCreationBytecode
      ? keccak256(verification.onchainCreationBytecode)
      : undefined,
    keccak256OnchainRuntimeBytecode: keccak256(
      verification.onchainRuntimeBytecode,
    ),
    keccak256RecompiledCreationBytecode: normalizedCreationBytecode
      ? keccak256(normalizedCreationBytecode)
      : undefined,
    keccak256RecompiledRuntimeBytecode: keccak256(normalizedRuntimeBytecode),
  };
}

export async function getDatabaseColumnsFromVerification(
  verification: VerificationExport,
): Promise<DatabaseColumns> {
  // Normalize both creation and runtime recompiled bytecodes before storing them to the database
  const { normalizedRuntimeBytecode, normalizedCreationBytecode } =
    normalizeRecompiledBytecodes(verification);

  const {
    keccak256OnchainCreationBytecode,
    keccak256OnchainRuntimeBytecode,
    keccak256RecompiledCreationBytecode,
    keccak256RecompiledRuntimeBytecode,
  } = getKeccak256Bytecodes(
    verification,
    normalizedCreationBytecode,
    normalizedRuntimeBytecode,
  );

  const runtimeMatch =
    verification.status.runtimeMatch === "perfect" ||
    verification.status.runtimeMatch === "partial";
  const creationMatch =
    verification.status.creationMatch === "perfect" ||
    verification.status.creationMatch === "partial";

  const {
    runtime: {
      list: runtimeTransformations,
      values: runtimeTransformationValues,
    },
    creation: {
      list: creationTransformations,
      values: creationTransformationValues,
    },
  } = verification.transformations;

  // Force _transformations and _values to be null if not match
  // Force _transformations and _values to be not null if match
  let runtime_transformations = null;
  let runtime_values = null;
  let runtime_metadata_match = null;
  if (runtimeMatch) {
    runtime_transformations = runtimeTransformations
      ? runtimeTransformations
      : [];
    runtime_values = runtimeTransformationValues
      ? runtimeTransformationValues
      : {};
    runtime_metadata_match = verification.status.runtimeMatch === "perfect";
  }
  let creation_transformations = null;
  let creation_values = null;
  let creation_metadata_match = null;
  if (creationMatch) {
    creation_transformations = creationTransformations
      ? creationTransformations
      : [];
    creation_values = creationTransformationValues
      ? creationTransformationValues
      : {};
    creation_metadata_match = verification.status.creationMatch === "perfect";
  }

  const compilationTargetPath = verification.compilation.compilationTarget.path;
  const compilationTargetName = verification.compilation.compilationTarget.name;
  const compilerOutput = verification.compilation.contractCompilerOutput;

  // For some property we cast compilerOutput as SolidityOutputContract because VyperOutput does not have them
  const compilationArtifacts = {
    abi: compilerOutput?.abi || null,
    userdoc: compilerOutput?.userdoc || null,
    devdoc: compilerOutput?.devdoc || null,
    storageLayout:
      (compilerOutput as SolidityOutputContract)?.storageLayout || null,
    sources: verification.compilation.compilerOutput?.sources || null,
  };
  const creationCodeArtifacts = {
    sourceMap:
      (compilerOutput as SolidityOutputContract)?.evm?.bytecode?.sourceMap ||
      null,
    linkReferences:
      (compilerOutput as SolidityOutputContract)?.evm?.bytecode
        ?.linkReferences || null,
    cborAuxdata: verification.compilation.creationBytecodeCborAuxdata || null,
  };

  let immutableReferences = null;
  // immutableReferences for Vyper are not a compiler output and should not be stored
  if (verification.compilation.language === "Solidity") {
    immutableReferences = verification.compilation.immutableReferences || null;
  }
  const runtimeCodeArtifacts = {
    sourceMap: compilerOutput?.evm.deployedBytecode?.sourceMap || null,
    linkReferences:
      (compilerOutput as SolidityOutputContract)?.evm?.deployedBytecode
        ?.linkReferences || null,
    immutableReferences: immutableReferences,
    cborAuxdata: verification.compilation.runtimeBytecodeCborAuxdata || null,
  };

  // runtime bytecodes must exist
  if (normalizedRuntimeBytecode === undefined) {
    throw new Error("Missing normalized runtime bytecode");
  }
  if (verification.onchainRuntimeBytecode === undefined) {
    throw new Error("Missing onchain runtime bytecode");
  }

  let recompiledCreationCode: Omit<Tables.ICode, "bytecode_hash"> | undefined;
  if (normalizedCreationBytecode && keccak256RecompiledCreationBytecode) {
    recompiledCreationCode = {
      bytecode_hash_keccak: keccak256RecompiledCreationBytecode,
      bytecode: normalizedCreationBytecode,
    };
  }

  let onchainCreationCode: Omit<Tables.ICode, "bytecode_hash"> | undefined;
  if (
    verification.onchainCreationBytecode &&
    keccak256OnchainCreationBytecode
  ) {
    onchainCreationCode = {
      bytecode_hash_keccak: keccak256OnchainCreationBytecode,
      bytecode: verification.onchainCreationBytecode,
    };
  }

  const sourcesInformation = Object.keys(verification.compilation.sources).map(
    (path) => ({
      path,
      source_hash_keccak: keccak256(
        Buffer.from(verification.compilation.sources[path]),
      ),
      content: verification.compilation.sources[path],
    }),
  );

  return {
    recompiledCreationCode,
    recompiledRuntimeCode: {
      bytecode_hash_keccak: keccak256RecompiledRuntimeBytecode,
      bytecode: normalizedRuntimeBytecode,
    },
    onchainCreationCode,
    onchainRuntimeCode: {
      bytecode_hash_keccak: keccak256OnchainRuntimeBytecode,
      bytecode: verification.onchainRuntimeBytecode,
    },
    contractDeployment: {
      chain_id: verification.chainId,
      address: verification.address,
      transaction_hash: verification.deploymentInfo.txHash,
      block_number: verification.deploymentInfo.blockNumber,
      transaction_index: verification.deploymentInfo.txIndex,
      deployer: verification.deploymentInfo.deployer,
    },
    compiledContract: {
      language: verification.compilation.language.toLocaleLowerCase(),
      compiler:
        verification.compilation.language.toLocaleLowerCase() === "solidity"
          ? "solc"
          : "vyper",
      compiler_settings: prepareCompilerSettingsFromVerification(verification),
      name: verification.compilation.compilationTarget.name,
      version: verification.compilation.compilerVersion,
      fully_qualified_name: `${compilationTargetPath}:${compilationTargetName}`,
      compilation_artifacts: compilationArtifacts,
      creation_code_artifacts: creationCodeArtifacts,
      runtime_code_artifacts: runtimeCodeArtifacts,
    },
    sourcesInformation,
    verifiedContract: {
      runtime_transformations,
      creation_transformations,
      runtime_values,
      creation_values,
      runtime_match: runtimeMatch,
      creation_match: creationMatch,
      // We cover also no-metadata case by using match === "perfect"
      runtime_metadata_match,
      creation_metadata_match,
    },
  };
}

export function prepareCompilerSettingsFromVerification(
  verification: VerificationExport,
): Omit<SoliditySettings | VyperSettings, "outputSelection"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { outputSelection, ...restSettings } =
    verification.compilation.jsonInput.settings;
  return restSettings;
}
