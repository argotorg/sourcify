/**
 * Data types when inserting into Dune
 */

type DuneVarbinary = string;
type DuneBigint = string;
type DuneObject = string;

export interface InsertData {
  code: Array<{
    code_hash: DuneVarbinary;
    code: DuneVarbinary | null;
    code_hash_keccak: DuneVarbinary;
    created_at: Date;
    updated_at: Date;
    created_by: string;
    updated_by: string;
  }>;
  compiled_contracts: Array<{
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
    compiler_settings: DuneObject;
    compilation_artifacts: DuneObject;
    creation_code_hash: DuneVarbinary;
    creation_code_artifacts: DuneObject;
    runtime_code_hash: DuneVarbinary;
    runtime_code_artifacts: DuneObject;
  }>;
  compiled_contracts_sources: Array<{
    id: string;
    compilation_id: string;
    source_hash: DuneVarbinary;
    path: string;
  }>;
  contract_deployments: Array<{
    id: string;
    chain_id: DuneBigint;
    address: DuneVarbinary;
    transaction_hash: DuneVarbinary | null;
    block_number: DuneBigint | null;
    transaction_index: number | null;
    deployer: DuneVarbinary | null;
    contract_id: string;
    created_at: Date;
    updated_at: Date;
    created_by: string;
    updated_by: string;
  }>;
  contracts: Array<{
    id: string;
    creation_code_hash: DuneVarbinary | null;
    runtime_code_hash: DuneVarbinary;
    created_at: Date;
    updated_at: Date;
    created_by: string;
    updated_by: string;
  }>;
  sources: Array<{
    source_hash: DuneVarbinary;
    source_hash_keccak: DuneVarbinary;
    content: DuneVarbinary;
    created_at: Date;
    updated_at: Date;
    created_by: string;
    updated_by: string;
  }>;
  sourcify_matches: Array<{
    id: DuneBigint;
    verified_contract_id: DuneBigint;
    creation_match: DuneVarbinary | null;
    runtime_match: DuneVarbinary | null;
    created_at: Date;
    updated_at: Date;
    metadata: DuneObject;
  }>;
  verified_contracts: Array<{
    id: DuneBigint;
    created_at: Date;
    updated_at: Date;
    created_by: string;
    updated_by: string;
    deployment_id: string;
    compilation_id: string;
    creation_match: boolean;
    creation_values: DuneObject | null;
    creation_transformations: DuneObject | null;
    runtime_match: boolean;
    runtime_values: DuneObject | null;
    runtime_transformations: DuneObject | null;
    runtime_metadata_match: boolean | null;
    creation_metadata_match: boolean | null;
  }>;
}

export default class DuneClient {
  private readonly baseUrl = "https://api.dune.com/api/v1/table";
  private readonly headers: { [key: string]: string };
  private readonly namespace = process.env.DUNE_NAMESPACE || "sourcify";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("API key is required");
    }

    this.headers = {
      "x-dune-api-key": apiKey,
      "Content-Type": "application/x-ndjson",
    };
  }

  async insertCode(code: InsertData["code"]) {
    return this.prepareInsertRequest(code, "code");
  }

  async insertCompiledContracts(
    compiledContracts: InsertData["compiled_contracts"],
  ) {
    return this.prepareInsertRequest(compiledContracts, "compiled_contracts");
  }

  async insertCompiledContractsSources(
    compiledContractsSources: InsertData["compiled_contracts_sources"],
  ) {
    return this.prepareInsertRequest(
      compiledContractsSources,
      "compiled_contracts_sources",
    );
  }

  async insertContractDeployments(
    contractDeployments: InsertData["contract_deployments"],
  ) {
    return this.prepareInsertRequest(
      contractDeployments,
      "contract_deployments",
    );
  }

  async insertContracts(contracts: InsertData["contracts"]) {
    return this.prepareInsertRequest(contracts, "contracts");
  }

  async insertSources(sources: InsertData["sources"]) {
    return this.prepareInsertRequest(sources, "sources");
  }

  async insertSourcifyMatches(sourcifyMatches: InsertData["sourcify_matches"]) {
    return this.prepareInsertRequest(sourcifyMatches, "sourcify_matches");
  }

  async insertVerifiedContracts(
    verifiedContracts: InsertData["verified_contracts"],
  ): Promise<Response> {
    return this.prepareInsertRequest(verifiedContracts, "verified_contracts");
  }

  private prepareInsertRequest(data: any, tableName: string) {
    return fetch(
      `${this.baseUrl}/${this.namespace}/${tableName}/insert`,
      this.prepareRequestOptions(data),
    );
  }

  private prepareRequestOptions(data: any) {
    return {
      method: "POST",
      headers: this.headers,
      body: data.map((row: any) => JSON.stringify(row)).join("\n"), // Must send as newline delimited json (NDJSON)
    };
  }
}
