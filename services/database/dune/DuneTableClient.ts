interface SchemaField {
  name: string;
  type: string;
  nullable?: boolean;
}

interface CreateTableRequest {
  table_name: string;
  schema: SchemaField[];
}

export default class DuneTableClient {
  private readonly baseUrl = "https://api.dune.com/api/v1/table";
  private readonly headers: Record<string, string>;
  private readonly namespace = process.env.DUNE_NAMESPACE || "sourcify";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("API key is required");
    }

    this.headers = {
      "x-dune-api-key": apiKey,
      "Content-Type": "application/json",
    };
  }

  private async createTable(request: CreateTableRequest): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/create`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });
    return response;
  }

  async createCodeTable(): Promise<Response> {
    return this.createTable({
      table_name: "code",
      schema: [
        {
          name: "code_hash",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "code",
          type: "varbinary",
          nullable: true,
        },
        {
          name: "code_hash_keccak",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "updated_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "created_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "updated_by",
          type: "varchar",
          nullable: false,
        },
      ],
    });
  }

  async createCompiledContractsTable(): Promise<Response> {
    return this.createTable({
      table_name: "compiled_contracts",
      schema: [
        {
          name: "id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "updated_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "created_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "updated_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "compiler",
          type: "varchar",
          nullable: false,
        },
        {
          name: "version",
          type: "varchar",
          nullable: false,
        },
        {
          name: "language",
          type: "varchar",
          nullable: false,
        },
        {
          name: "name",
          type: "varchar",
          nullable: false,
        },
        {
          name: "fully_qualified_name",
          type: "varchar",
          nullable: false,
        },
        {
          name: "compiler_settings",
          type: "varchar",
          nullable: false,
        },
        {
          name: "compilation_artifacts",
          type: "varchar",
          nullable: false,
        },
        {
          name: "creation_code_hash",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "creation_code_artifacts",
          type: "varchar",
          nullable: false,
        },
        {
          name: "runtime_code_hash",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "runtime_code_artifacts",
          type: "varchar",
          nullable: false,
        },
      ],
    });
  }

  async createCompiledContractsSourcesTable(): Promise<Response> {
    return this.createTable({
      table_name: "compiled_contracts_sources",
      schema: [
        {
          name: "id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "compilation_id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "source_hash",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "path",
          type: "varchar",
          nullable: false,
        },
      ],
    });
  }

  async createContractDeploymentsTable(): Promise<Response> {
    return this.createTable({
      table_name: "contract_deployments",
      schema: [
        {
          name: "id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "chain_id",
          type: "bigint",
          nullable: false,
        },
        {
          name: "address",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "transaction_hash",
          type: "varbinary",
          nullable: true,
        },
        {
          name: "block_number",
          type: "bigint",
          nullable: true,
        },
        {
          name: "transaction_index",
          type: "integer",
          nullable: true,
        },
        {
          name: "deployer",
          type: "varbinary",
          nullable: true,
        },
        {
          name: "contract_id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "updated_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "created_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "updated_by",
          type: "varchar",
          nullable: false,
        },
      ],
    });
  }

  async createContractsTable(): Promise<Response> {
    return this.createTable({
      table_name: "contracts",
      schema: [
        {
          name: "id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "creation_code_hash",
          type: "varbinary",
          nullable: true,
        },
        {
          name: "runtime_code_hash",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "updated_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "created_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "updated_by",
          type: "varchar",
          nullable: false,
        },
      ],
    });
  }

  async createSourcesTable(): Promise<Response> {
    return this.createTable({
      table_name: "sources",
      schema: [
        {
          name: "source_hash",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "source_hash_keccak",
          type: "varbinary",
          nullable: false,
        },
        {
          name: "content",
          type: "varchar",
          nullable: false,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "updated_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "created_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "updated_by",
          type: "varchar",
          nullable: false,
        },
      ],
    });
  }

  async createSourcifyMatchesTable(): Promise<Response> {
    return this.createTable({
      table_name: "sourcify_matches",
      schema: [
        {
          name: "id",
          type: "bigint",
          nullable: false,
        },
        {
          name: "verified_contract_id",
          type: "bigint",
          nullable: false,
        },
        {
          name: "creation_match",
          type: "varchar",
          nullable: true,
        },
        {
          name: "runtime_match",
          type: "varchar",
          nullable: true,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "updated_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "metadata",
          type: "varchar",
          nullable: false,
        },
      ],
    });
  }

  async createVerifiedContractsTable(): Promise<Response> {
    return this.createTable({
      table_name: "verified_contracts",
      schema: [
        {
          name: "id",
          type: "bigint",
          nullable: false,
        },
        {
          name: "created_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "updated_at",
          type: "timestamp",
          nullable: false,
        },
        {
          name: "created_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "updated_by",
          type: "varchar",
          nullable: false,
        },
        {
          name: "deployment_id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "compilation_id",
          type: "varchar",
          nullable: false,
        },
        {
          name: "creation_match",
          type: "boolean",
          nullable: false,
        },
        {
          name: "creation_values",
          type: "varchar",
          nullable: true,
        },
        {
          name: "creation_transformations",
          type: "varchar",
          nullable: true,
        },
        {
          name: "runtime_match",
          type: "boolean",
          nullable: false,
        },
        {
          name: "runtime_values",
          type: "varchar",
          nullable: true,
        },
        {
          name: "runtime_transformations",
          type: "varchar",
          nullable: true,
        },
        {
          name: "runtime_metadata_match",
          type: "boolean",
          nullable: true,
        },
        {
          name: "creation_metadata_match",
          type: "boolean",
          nullable: true,
        },
      ],
    });
  }

  async deleteTable(table_name: string): Promise<Response> {
    console.log(`Deleting ${this.namespace}/${table_name} table...`);
    return fetch(`${this.baseUrl}/${this.namespace}/${table_name}`, {
      method: "DELETE",
      headers: this.headers,
    });
  }

  async deleteVerifiedContractsTable(): Promise<Response> {
    return this.deleteTable("verified_contracts");
  }
  async deleteCodeTable(): Promise<Response> {
    return this.deleteTable("code");
  }

  async deleteCompiledContractsTable(): Promise<Response> {
    return this.deleteTable("compiled_contracts");
  }

  async deleteCompiledContractsSourcesTable(): Promise<Response> {
    return this.deleteTable("compiled_contracts_sources");
  }

  async deleteContractDeploymentsTable(): Promise<Response> {
    return this.deleteTable("contract_deployments");
  }

  async deleteContractsTable(): Promise<Response> {
    return this.deleteTable("contracts");
  }

  async deleteSourcesTable(): Promise<Response> {
    return this.deleteTable("sources");
  }

  async deleteSourcifyMatchesTable(): Promise<Response> {
    return this.deleteTable("sourcify_matches");
  }

  async createAllTables(): Promise<void> {
    console.log("Starting table creation process...");
    try {
      await Promise.all([
        this.createCodeTable(),
        this.createCompiledContractsTable(),
        this.createCompiledContractsSourcesTable(),
        this.createContractDeploymentsTable(),
        this.createContractsTable(),
        this.createSourcesTable(),
        this.createSourcifyMatchesTable(),
        this.createVerifiedContractsTable(),
      ]);
      console.log("All tables created successfully!");
    } catch (error) {
      console.error("Error creating tables:", error);
      throw error;
    }
  }
}

export type { CreateTableRequest, SchemaField };
