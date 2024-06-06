// Types used internally by the server.

/**
 * A type for specfifying the strictness level of querying (only full, partial or any kind of matches)
 */
export type MatchLevel = "full_match" | "partial_match" | "any_match";

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
