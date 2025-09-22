import {
  Devdoc,
  ImmutableReferences,
  SolidityJsonInput,
  LinkReferences,
  Metadata,
  SolidityOutput,
  StorageLayout,
  Userdoc,
  VyperOutputSource,
  SolidityOutputSource,
  CompiledContractCborAuxdata,
  CompilationLanguage,
  Transformation,
  TransformationValues,
  VerificationStatus,
} from "@ethereum-sourcify/lib-sourcify";
import { Response } from "express";
import { Abi } from "abitype";
import { ProxyDetectionResult } from "../services/utils/proxy-contract-util";
import { GenericErrorResponse, MatchingErrorResponse } from "./api/errors";

// Types used internally by the server.

export type V1MatchLevelWithoutAny = "full_match" | "partial_match";

/**
 * A type for specfifying the strictness level of querying (only full, partial or any kind of matches)
 */
export type V1MatchLevel = V1MatchLevelWithoutAny | "any_match";

// New naming for matches in API v2
export type MatchLevel = "match" | "exact_match" | null;

// For displaying contracts in API v2
export interface VerifiedContractMinimal {
  match: MatchLevel;
  creationMatch: MatchLevel;
  runtimeMatch: MatchLevel;
  chainId: number;
  address: string;
  verifiedAt?: string;
  matchId?: number;
  licenseType?: number;
  contractLabel?: string;
}

// For displaying contracts in API v2
export interface VerifiedContract extends VerifiedContractMinimal {
  creationBytecode?: {
    onchainBytecode: Nullable<string>;
    recompiledBytecode: string;
    sourceMap: Nullable<string>;
    linkReferences: Nullable<LinkReferences>;
    cborAuxdata: Nullable<CompiledContractCborAuxdata>;
    transformations: Nullable<Transformation[]>;
    transformationValues: Nullable<TransformationValues>;
  };
  runtimeBytecode?: {
    onchainBytecode: string;
    recompiledBytecode: string;
    sourceMap: Nullable<string>;
    linkReferences: Nullable<LinkReferences>;
    cborAuxdata: Nullable<CompiledContractCborAuxdata>;
    immutableReferences: Nullable<ImmutableReferences>;
    transformations: Nullable<Transformation[]>;
    transformationValues: Nullable<TransformationValues>;
  };
  deployment?: {
    transactionHash: Nullable<string>;
    blockNumber: Nullable<string>;
    transactionIndex: Nullable<string>;
    deployer: Nullable<string>;
  };
  sources?: {
    [path: string]: { content: string };
  };
  compilation?: {
    language: CompilationLanguage;
    compiler: string;
    compilerVersion: string;
    compilerSettings: object;
    name: string;
    fullyQualifiedName: string;
  };
  abi?: Nullable<Abi>;
  metadata?: Nullable<Metadata>;
  storageLayout?: Nullable<StorageLayout>;
  userdoc?: Nullable<Userdoc>;
  devdoc?: Nullable<Devdoc>;
  sourceIds?: Nullable<
    Record<
      string,
      Pick<SolidityOutputSource, "id"> | Pick<VyperOutputSource, "id">
    >
  >;
  stdJsonInput?: SolidityJsonInput;
  stdJsonOutput?: SolidityOutput;
  proxyResolution?: ProxyResolution;
}

// TODO:
// onchain bytecodes are a temporary solution for running the proxy detection inside the getContractEndpoint handler.
// Remove onchainRuntimeBytecode and onchainCreationBytecode when proxy detection result is stored in database.
export type ProxyResolution = Partial<ProxyDetectionResult> & {
  onchainRuntimeBytecode?: string;
  onchainCreationBytecode?: Nullable<string>;
  proxyResolutionError?: GenericErrorResponse;
};

export type VerificationJobId = string;

export interface VerificationJob {
  isJobCompleted: boolean;
  verificationId: VerificationJobId;
  jobStartTime: string;
  jobFinishTime?: string;
  compilationTime?: number;
  error?: MatchingErrorResponse;
  contract: VerifiedContractMinimal;
}

/**
 * An array wrapper with info properties.
 */
export type FilesInfo<T> = { status: MatchQuality; files: T };

export type FilesRawValue = { [index: string]: string };

export type FilesRaw = {
  status: MatchQuality;
  files: FilesRawValue;
  sources: FilesRawValue;
};

/**
 * A type for specifying the match quality of files.
 */
export type MatchQuality = "full" | "partial";

export interface ContractData {
  full: string[];
  partial: string[];
}

export interface Pagination {
  currentPage: number;
  totalPages: number;
  resultsCurrentPage: number;
  resultsPerPage: number;
  totalResults: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedData<T> {
  results: T[];
  pagination: Pagination;
}

export type RepositoryTag = {
  timestamp: any;
};

export type PathConfig = {
  matchQuality: MatchQuality;
  chainId: string;
  address: string;
  fileName?: string;
  source?: boolean;
};

export type FileObject = {
  name: string;
  path: string;
  content?: string;
};

export type MethodNames<T> = {
  // The part: T[K] extends (...args: any) => any checks if T[K] is a function. If yes then it returns K, the method name, else it returns never
  [K in keyof T]: T[K] extends (...args: any) => any ? K : never;
}[keyof T]; // [keyof T] returns the keys of T, in this case the method names

export type MethodArgs<T, K extends keyof T> = T[K] extends (
  ...args: infer A
) => any
  ? A
  : never;

export type MethodReturnType<T, K extends keyof T> = T[K] extends (
  ...args: any
) => infer R
  ? R
  : never;

export type Mandatory<T> = {
  [P in keyof T]-?: T[P];
};

export type Nullable<T> = T | null;

// Declare a unique symbol to be used as a brand key
declare const __brand: unique symbol;
// Define a generic type `Brand` that uses the unique symbol as a key
type Brand<B> = { [__brand]: B };
// Define a generic type `Branded` that combines a type `T` with a brand `B`
type Branded<T, B> = T & Brand<B>;

// In order to have two different types for BytesSha and BytesKeccak we "brand" them
// with unique identifiers, this gives us stricter type safety
export type Bytes = Buffer;
export type BytesSha = Branded<Buffer, "SHA">;
export type BytesKeccak = Branded<Buffer, "KECCAK">;

export type BytesTypes = Bytes | BytesKeccak | BytesSha;

export type TypedResponse<T> = Omit<Response, "json" | "status"> & {
  json(data: T): TypedResponse<T>;
} & { status(code: number): TypedResponse<T> };

export interface Create2Args {
  deployerAddress: string;
  salt: string;
  constructorArgs?: any[];
}

export interface Match {
  address: string;
  chainId: number;
  runtimeMatch: VerificationStatus;
  creationMatch: VerificationStatus;
  storageTimestamp?: Date;
  onchainRuntimeBytecode?: string;
  contractName?: string;
  message?: string;
}
