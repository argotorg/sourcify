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
  Bytes,
  BytesSha,
  BytesKeccak,
  BytesTypes,
  Nullable,
} from "../../types";
import { keccak256 } from "ethers";

export type JobErrorData = Omit<SourcifyLibErrorData, "chainId" | "address">;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Tables {
  export interface Code {
    bytecode_hash: BytesSha;
    bytecode_hash_keccak: BytesKeccak;
    bytecode: Bytes;
  }
  export interface Contract {
    id: string;
    creation_bytecode_hash?: BytesSha;
    runtime_bytecode_hash: BytesSha;
  }
  export interface ContractDeployment {
    id: string;
    chain_id: string;
    address: Bytes;
    transaction_hash?: Bytes;
    contract_id: string;
    block_number?: number;
    transaction_index?: number;
    deployer?: Bytes;
  }

  export interface CompiledContract {
    id: string;
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
      sources: Nullable<CompilationArtifactsSources>;
    };
    compiler_settings: Omit<
      SoliditySettings | VyperSettings,
      "outputSelection"
    >;
    creation_code_hash?: BytesSha;
    runtime_code_hash: BytesSha;
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

  export interface VerifiedContract {
    id: string;
    compilation_id: string;
    deployment_id: string;
    creation_transformations: Nullable<Transformation[]>;
    creation_values: Nullable<TransformationValues>;
    runtime_transformations: Nullable<Transformation[]>;
    runtime_values: Nullable<TransformationValues>;
    runtime_match: boolean;
    creation_match: boolean;
    runtime_metadata_match: Nullable<boolean>;
    creation_metadata_match: Nullable<boolean>;
  }

  export interface Sources {
    source_hash: BytesSha;
    source_hash_keccak: BytesKeccak;
    content: string;
  }

  export interface CompiledContractsSources {
    id: string;
    compilation_id: string;
    source_hash: BytesSha;
    path: string;
  }

  export interface SourcifyMatch {
    id: string;
    verified_contract_id: string;
    runtime_match: VerificationStatus | null;
    creation_match: VerificationStatus | null;
    metadata: Metadata;
    created_at: Date;
  }

  export interface SourcifySync {
    chain_id: number;
    address: string;
    match_type: string;
  }

  export interface CompilationArtifactsSources {
    [globalName: string]: {
      id: number;
    };
  }

  export interface VerificationJob {
    id: string;
    started_at: Date;
    completed_at: Nullable<Date>;
    chain_id: string;
    contract_address: Bytes;
    verified_contract_id: Nullable<string>;
    error_code: Nullable<string>;
    error_id: Nullable<string>;
    error_data: Nullable<JobErrorData>;
    verification_endpoint: string;
    hardware: Nullable<string>;
    compilation_time: Nullable<string>;
  }

  export interface VerificationJobEphemeral {
    id: string;
    recompiled_creation_code: Nullable<Bytes>;
    recompiled_runtime_code: Nullable<Bytes>;
    onchain_creation_code: Nullable<Bytes>;
    onchain_runtime_code: Nullable<Bytes>;
    creation_transaction_hash: Nullable<Bytes>;
  }
}

export interface SourceInformation {
  source_hash_keccak: BytesKeccak;
  content: string;
  path: string;
}

// This object contains all Tables fields except foreign keys generated during INSERTs
export interface DatabaseColumns {
  recompiledCreationCode?: Omit<Tables.Code, "bytecode_hash">;
  recompiledRuntimeCode: Omit<Tables.Code, "bytecode_hash">;
  onchainCreationCode?: Omit<Tables.Code, "bytecode_hash">;
  onchainRuntimeCode: Omit<Tables.Code, "bytecode_hash">;
  contractDeployment: Omit<Tables.ContractDeployment, "id" | "contract_id">;
  compiledContract: Omit<
    Tables.CompiledContract,
    "id" | "creation_code_hash" | "runtime_code_hash"
  >;
  verifiedContract: Omit<
    Tables.VerifiedContract,
    "id" | "compilation_id" | "deployment_id"
  >;
  sourcesInformation: SourceInformation[];
}

export type GetVerifiedContractByChainAndAddressResult =
  Tables.VerifiedContract & {
    transaction_hash: Bytes | null;
    contract_id: string;
  };

export type GetSourcifyMatchByChainAddressResult = Tables.SourcifyMatch &
  Pick<
    Tables.VerifiedContract,
    "creation_values" | "runtime_values" | "compilation_id"
  > &
  Pick<Tables.CompiledContract, "runtime_code_artifacts" | "name"> &
  Pick<Tables.ContractDeployment, "transaction_hash"> & {
    onchain_runtime_code: string;
  };

export type GetSourcifyMatchesAllChainsResult = Pick<
  Tables.SourcifyMatch,
  "id" | "creation_match" | "runtime_match"
> &
  Pick<Tables.ContractDeployment, "chain_id"> & {
    address: string;
    verified_at: string;
  };

export type GetSourcifyMatchesByChainResult = Pick<
  Tables.SourcifyMatch,
  "id" | "creation_match" | "runtime_match"
> & { address: string; verified_at: string };

export type GetSourcifyMatchByChainAddressWithPropertiesResult = Partial<
  Pick<
    Tables.SourcifyMatch,
    "id" | "creation_match" | "runtime_match" | "metadata"
  > &
    Pick<
      Tables.CompiledContract,
      | "language"
      | "compiler"
      | "version"
      | "compiler_settings"
      | "name"
      | "fully_qualified_name"
    > &
    Pick<
      Tables.CompiledContract["compilation_artifacts"],
      "abi" | "userdoc" | "devdoc"
    > &
    Pick<
      Tables.VerifiedContract,
      | "creation_transformations"
      | "creation_values"
      | "runtime_transformations"
      | "runtime_values"
    > &
    Pick<
      Tables.ContractDeployment,
      "block_number" | "transaction_index" | "chain_id"
    > & {
      verified_at: string;
      address: string;
      onchain_creation_code: string;
      recompiled_creation_code: string;
      creation_source_map: Tables.CompiledContract["creation_code_artifacts"]["sourceMap"];
      creation_link_references: Tables.CompiledContract["creation_code_artifacts"]["linkReferences"];
      creation_cbor_auxdata: Tables.CompiledContract["creation_code_artifacts"]["cborAuxdata"];
      onchain_runtime_code: string;
      recompiled_runtime_code: string;
      runtime_source_map: Tables.CompiledContract["runtime_code_artifacts"]["sourceMap"];
      runtime_link_references: Tables.CompiledContract["runtime_code_artifacts"]["linkReferences"];
      runtime_cbor_auxdata: Tables.CompiledContract["runtime_code_artifacts"]["cborAuxdata"];
      runtime_immutable_references: Tables.CompiledContract["runtime_code_artifacts"]["immutableReferences"];
      transaction_hash: string;
      deployer: string;
      sources: { [path: string]: { content: string } };
      storage_layout: Tables.CompiledContract["compilation_artifacts"]["storageLayout"];
      source_ids: Tables.CompiledContract["compilation_artifacts"]["sources"];
      std_json_input: SolidityJsonInput | VyperJsonInput;
      std_json_output: SolidityOutput | VyperOutput;
    }
>;

export type GetVerificationJobByIdResult = Pick<
  Tables.VerificationJob,
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
  runtime_match: Nullable<Tables.VerifiedContract["runtime_match"]>;
  creation_match: Nullable<Tables.VerifiedContract["creation_match"]>;
  runtime_metadata_match: Nullable<
    Tables.VerifiedContract["runtime_metadata_match"]
  >;
  creation_metadata_match: Nullable<
    Tables.VerifiedContract["creation_metadata_match"]
  >;
  match_id: Nullable<Tables.SourcifyMatch["id"]>;
  verified_at: Nullable<string>;
};

export type GetVerificationJobsByChainAndAddressResult = {
  completed_at: Nullable<string>;
};

const sourcesAggregation =
  "json_object_agg(compiled_contracts_sources.path, json_build_object('content', sources.content))";

export const STORED_PROPERTIES_TO_SELECTORS = {
  id: "sourcify_matches.id",
  creation_match: "sourcify_matches.creation_match",
  runtime_match: "sourcify_matches.runtime_match",
  chain_id: "contract_deployments.chain_id",
  verified_at:
    'to_char(sourcify_matches.created_at, \'YYYY-MM-DD"T"HH24:MI:SS"Z"\') as verified_at',
  address:
    "nullif(concat('0x', encode(contract_deployments.address, 'hex')), '0x') as address",
  onchain_creation_code:
    "nullif(concat('0x', encode(onchain_creation_code.code, 'hex')), '0x') as onchain_creation_code",
  recompiled_creation_code:
    "nullif(concat('0x', encode(recompiled_creation_code.code, 'hex')), '0x') as recompiled_creation_code",
  creation_source_map:
    "compiled_contracts.creation_code_artifacts->'sourceMap' as creation_source_map",
  creation_link_references:
    "compiled_contracts.creation_code_artifacts->'linkReferences' as creation_link_references",
  creation_cbor_auxdata:
    "compiled_contracts.creation_code_artifacts->'cborAuxdata' as creation_cbor_auxdata",
  creation_transformations: "verified_contracts.creation_transformations",
  creation_values: "verified_contracts.creation_values",
  onchain_runtime_code:
    "nullif(concat('0x', encode(onchain_runtime_code.code, 'hex')), '0x') as onchain_runtime_code",
  recompiled_runtime_code:
    "nullif(concat('0x', encode(recompiled_runtime_code.code, 'hex')), '0x') as recompiled_runtime_code",
  runtime_source_map:
    "compiled_contracts.runtime_code_artifacts->'sourceMap' as runtime_source_map",
  runtime_link_references:
    "compiled_contracts.runtime_code_artifacts->'linkReferences' as runtime_link_references",
  runtime_cbor_auxdata:
    "compiled_contracts.runtime_code_artifacts->'cborAuxdata' as runtime_cbor_auxdata",
  runtime_immutable_references:
    "compiled_contracts.runtime_code_artifacts->'immutableReferences' as runtime_immutable_references",
  runtime_transformations: "verified_contracts.runtime_transformations",
  runtime_values: "verified_contracts.runtime_values",
  transaction_hash:
    "nullif(concat('0x', encode(contract_deployments.transaction_hash, 'hex')), '0x') as transaction_hash",
  block_number: "contract_deployments.block_number",
  transaction_index: "contract_deployments.transaction_index",
  deployer:
    "nullif(concat('0x', encode(contract_deployments.deployer, 'hex')), '0x') as deployer",
  sources: `${sourcesAggregation} as sources`,
  language: "INITCAP(compiled_contracts.language) as language",
  compiler: "compiled_contracts.compiler",
  version: "compiled_contracts.version as version",
  compiler_settings: "compiled_contracts.compiler_settings",
  name: "compiled_contracts.name",
  fully_qualified_name: "compiled_contracts.fully_qualified_name",
  abi: "compiled_contracts.compilation_artifacts->'abi' as abi",
  metadata: "sourcify_matches.metadata",
  storage_layout:
    "compiled_contracts.compilation_artifacts->'storageLayout' as storage_layout",
  userdoc: "compiled_contracts.compilation_artifacts->'userdoc' as userdoc",
  devdoc: "compiled_contracts.compilation_artifacts->'devdoc' as devdoc",
  source_ids:
    "compiled_contracts.compilation_artifacts->'sources' as source_ids",
  std_json_input: `json_build_object(
    'language', INITCAP(compiled_contracts.language), 
    'sources', ${sourcesAggregation},
    'settings', compiled_contracts.compiler_settings
  ) as std_json_input`,
  std_json_output: `json_build_object(
    'sources', compiled_contracts.compilation_artifacts->'sources',
    'contracts', json_build_object(
      substring(
        compiled_contracts.fully_qualified_name, 
        1, 
        length(compiled_contracts.fully_qualified_name) - length(split_part(compiled_contracts.fully_qualified_name, ':', -1)) - 1
      ), 
      json_build_object(
        split_part(compiled_contracts.fully_qualified_name, ':', -1), json_build_object(
          'abi', compiled_contracts.compilation_artifacts->'abi',
          'metadata', cast(sourcify_matches.metadata as text),
          'userdoc', compiled_contracts.compilation_artifacts->'userdoc',
          'devdoc', compiled_contracts.compilation_artifacts->'devdoc',
          'storageLayout', compiled_contracts.compilation_artifacts->'storageLayout',
          'evm', json_build_object(
            'bytecode', json_build_object(
              'object', nullif(concat('0x', encode(recompiled_creation_code.code, 'hex')), '0x'),
              'sourceMap', compiled_contracts.creation_code_artifacts->'sourceMap',
              'linkReferences', compiled_contracts.creation_code_artifacts->'linkReferences'
            ),
            'deployedBytecode', json_build_object(
              'object', nullif(concat('0x', encode(recompiled_runtime_code.code, 'hex')), '0x'),
              'sourceMap', compiled_contracts.runtime_code_artifacts->'sourceMap',
              'linkReferences', compiled_contracts.runtime_code_artifacts->'linkReferences',
              'immutableReferences', compiled_contracts.runtime_code_artifacts->'immutableReferences'
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
  },
};

export type Field =
  | keyof typeof FIELDS_TO_STORED_PROPERTIES
  | `creationBytecode.${creationBytecodeSubfields}`
  | `runtimeBytecode.${runtimeBytecodeSubfields}`
  | `deployment.${deploymentSubfields}`
  | `compilation.${compilationSubfields}`;

// Function overloads
export function bytesFromString<T extends BytesTypes>(str: string): T;
export function bytesFromString<T extends BytesTypes>(
  str: string | undefined,
): T | undefined;

export function bytesFromString<T extends BytesTypes>(
  str: string | undefined,
): T | undefined {
  if (str === undefined) {
    return undefined;
  }
  let stringWithout0x;
  if (str.substring(0, 2) === "0x") {
    stringWithout0x = str.substring(2);
  } else {
    stringWithout0x = str;
  }
  return Buffer.from(stringWithout0x, "hex") as T;
}

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

  // Runtime bytecode normalzations
  verification.transformations.runtime.list.forEach((transformation) => {
    if (transformation.reason === "library" && normalizedRuntimeBytecode) {
      const placeholder = "0".repeat(PLACEHOLDER_LENGTH);
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
      const placeholder = "0".repeat(PLACEHOLDER_LENGTH);
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
      ? keccak256(bytesFromString(verification.onchainCreationBytecode))
      : undefined,
    keccak256OnchainRuntimeBytecode: keccak256(
      bytesFromString(verification.onchainRuntimeBytecode),
    ),
    keccak256RecompiledCreationBytecode: normalizedCreationBytecode
      ? keccak256(bytesFromString(normalizedCreationBytecode))
      : undefined,
    keccak256RecompiledRuntimeBytecode: keccak256(
      bytesFromString(normalizedRuntimeBytecode),
    ),
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

  let recompiledCreationCode: Omit<Tables.Code, "bytecode_hash"> | undefined;
  if (normalizedCreationBytecode && keccak256RecompiledCreationBytecode) {
    recompiledCreationCode = {
      bytecode_hash_keccak: bytesFromString<BytesKeccak>(
        keccak256RecompiledCreationBytecode,
      ),
      bytecode: bytesFromString<Bytes>(normalizedCreationBytecode),
    };
  }

  let onchainCreationCode: Omit<Tables.Code, "bytecode_hash"> | undefined;

  try {
    if (
      verification.onchainCreationBytecode &&
      keccak256OnchainCreationBytecode
    ) {
      onchainCreationCode = {
        bytecode_hash_keccak: bytesFromString<BytesKeccak>(
          keccak256OnchainCreationBytecode,
        ),
        bytecode: bytesFromString<Bytes>(verification.onchainCreationBytecode),
      };
    }
  } catch (e) {
    // If the onchain creation bytecode is undefined, we don't store it
  }

  const sourcesInformation = Object.keys(verification.compilation.sources).map(
    (path) => {
      return {
        path,
        source_hash_keccak: bytesFromString<BytesKeccak>(
          keccak256(Buffer.from(verification.compilation.sources[path])),
        ),
        content: verification.compilation.sources[path],
      };
    },
  );

  return {
    recompiledCreationCode,
    recompiledRuntimeCode: {
      bytecode_hash_keccak: bytesFromString<BytesKeccak>(
        keccak256RecompiledRuntimeBytecode,
      ),
      bytecode: bytesFromString<Bytes>(normalizedRuntimeBytecode),
    },
    onchainCreationCode,
    onchainRuntimeCode: {
      bytecode_hash_keccak: bytesFromString<BytesKeccak>(
        keccak256OnchainRuntimeBytecode,
      ),
      bytecode: bytesFromString<Bytes>(verification.onchainRuntimeBytecode),
    },
    contractDeployment: {
      chain_id: verification.chainId.toString(),
      address: bytesFromString(verification.address),
      transaction_hash: bytesFromString(verification.deploymentInfo.txHash),
      block_number: verification.deploymentInfo.blockNumber,
      transaction_index: verification.deploymentInfo.txIndex,
      deployer: bytesFromString(verification.deploymentInfo.deployer),
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
