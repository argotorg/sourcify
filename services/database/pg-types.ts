// Type definitions for rows fetched from the database with the pg client
// E.g. pg fetches numbers as strings

import {
  Transformation,
  TransformationValues,
} from "@ethereum-sourcify/lib-sourcify";

export interface PgVerifiedContract {
  id: string;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
  compilation_id: string;
  deployment_id: string;
  creation_transformations: Transformation[] | null;
  creation_values: TransformationValues | null;
  runtime_transformations: Transformation[] | null;
  runtime_values: TransformationValues | null;
  runtime_match: boolean;
  creation_match: boolean;
  runtime_metadata_match: boolean | null;
  creation_metadata_match: boolean | null;
}

export interface PgCompiledContract {
  id: string;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
  compiler: string;
  version: string;
  language: string;
  name: string;
  fully_qualified_name: string;
  compiler_settings: any;
  compilation_artifacts: any;
  creation_code_hash: Buffer;
  creation_code_artifacts: any;
  runtime_code_hash: Buffer;
  runtime_code_artifacts: any;
}

export interface PgContractDeployment {
  id: string;
  chain_id: string;
  address: Buffer;
  transaction_hash: Buffer | null;
  block_number: string | null;
  transaction_index: string | null;
  deployer: Buffer | null;
  contract_id: string;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
}

export interface PgContract {
  id: string;
  creation_code_hash: Buffer | null;
  runtime_code_hash: Buffer;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
}

export interface PgCode {
  code_hash: Buffer;
  code: Buffer | null;
  code_hash_keccak: Buffer;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
}

export interface PgCompiledContractsSource {
  id: string;
  compilation_id: string;
  source_hash: Buffer;
  path: string;
}

export interface PgSource {
  source_hash: Buffer;
  source_hash_keccak: Buffer;
  content: string;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
}

export interface PgSourcifyMatch {
  id: string;
  verified_contract_id: string;
  creation_match: string | null;
  runtime_match: string | null;
  created_at: Date;
  updated_at: Date;
  metadata: any;
}
