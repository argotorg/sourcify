// Types used internally by the server.

export type MatchLevelWithoutAny = "full_match" | "partial_match";

/**
 * A type for specfifying the strictness level of querying (only full, partial or any kind of matches)
 */
export type MatchLevel = MatchLevelWithoutAny | "any_match";

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

export declare interface ContractData {
  full: string[];
  partial: string[];
}

export declare interface PaginatedContractData {
  results: string[];
  pagination: {
    currentPage: number;
    totalPages: number;
    resultsCurrentPage: number;
    resultsPerPage: number;
    totalResults: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
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
