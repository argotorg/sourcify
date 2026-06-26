/**
 * Utility functions to format the rows from Postgres (and from the pg client) to the format Dune expects
 */

import type {
  PgCode,
  PgCompiledContractsSource,
  PgContract,
  PgSource,
  PgSourcifyMatch,
  PgVerifiedContract,
} from "../pg-types";
import type { PgCompiledContract, PgContractDeployment } from "../pg-types";
import type { InsertData } from "./DuneDataClient";

// Dune's "varbinary" type MUST be prefixed with 0x otherwise the value will be incorrect
function bufferToHex(buffer: Buffer): string {
  return "0x" + buffer.toString("hex");
}

export function formatSourcifyMatches(
  sourcifyMatches: PgSourcifyMatch[],
): InsertData["sourcify_matches"] {
  return sourcifyMatches.map((row) => ({
    ...row,
    metadata: JSON.stringify(row.metadata),
  }));
}

export function formatSources(sources: PgSource[]): InsertData["sources"] {
  return sources.map((row) => ({
    ...row,
    source_hash: bufferToHex(row.source_hash),
    source_hash_keccak: bufferToHex(row.source_hash_keccak),
  }));
}

export function formatCompiledContractsSources(
  compiledContractsSources: PgCompiledContractsSource[],
): InsertData["compiled_contracts_sources"] {
  return compiledContractsSources.map((row) => ({
    ...row,
    source_hash: bufferToHex(row.source_hash),
  }));
}

export function formatCode(codes: PgCode[]): InsertData["code"] {
  return codes.map((code) => ({
    ...code,
    code_hash: bufferToHex(code.code_hash),
    code: code.code ? bufferToHex(code.code) : null,
    code_hash_keccak: bufferToHex(code.code_hash_keccak),
  }));
}

export function formatContracts(
  contracts: PgContract[],
): InsertData["contracts"] {
  return contracts.map((row) => ({
    ...row,
    creation_code_hash: row.creation_code_hash
      ? bufferToHex(row.creation_code_hash)
      : null,
    runtime_code_hash: bufferToHex(row.runtime_code_hash),
  }));
}

export function formatContractDeployments(
  contractDeployments: PgContractDeployment[],
): InsertData["contract_deployments"] {
  return contractDeployments.map((row) => ({
    ...row,
    address: bufferToHex(row.address),
    transaction_hash: row.transaction_hash
      ? bufferToHex(row.transaction_hash)
      : null,
    transaction_index: row.transaction_index
      ? parseInt(row.transaction_index)
      : null,
    deployer: row.deployer ? bufferToHex(row.deployer) : null,
  }));
}
export function formatCompiledContracts(
  compiledContracts: PgCompiledContract[],
): InsertData["compiled_contracts"] {
  return compiledContracts.map((row) => ({
    ...row,
    compiler_settings: JSON.stringify(row.compiler_settings),
    compilation_artifacts: JSON.stringify(row.compilation_artifacts),
    creation_code_hash: bufferToHex(row.creation_code_hash),
    creation_code_artifacts: JSON.stringify(row.creation_code_artifacts),
    runtime_code_hash: bufferToHex(row.runtime_code_hash),
    runtime_code_artifacts: JSON.stringify(row.runtime_code_artifacts),
  }));
}

export function formatVerifiedContracts(
  verifiedContracts: PgVerifiedContract[],
): InsertData["verified_contracts"] {
  return verifiedContracts.map((row) => ({
    ...row,
    creation_values: row.creation_values
      ? JSON.stringify(row.creation_values)
      : null,
    creation_transformations: row.creation_transformations
      ? JSON.stringify(row.creation_transformations)
      : null,
    runtime_values: row.runtime_values
      ? JSON.stringify(row.runtime_values)
      : null,
    runtime_transformations: row.runtime_transformations
      ? JSON.stringify(row.runtime_transformations)
      : null,
  }));
}
