import {
  CompiledContractCborAuxdata,
  ISolidityCompiler,
  IVyperCompiler,
  Metadata,
  PreRunCompilation,
  SolidityJsonInput,
  SolidityOutput,
  VyperJsonInput,
  VyperOutput,
} from "@ethereum-sourcify/lib-sourcify";
import { bytesFromString } from "./database-util";
import { Database } from "./Database";
import logger from "../../../common/logger";

export class DatabaseCompilation {
  public jsonInput?: SolidityJsonInput | VyperJsonInput;
  public jsonOutput?: SolidityOutput | VyperOutput;
  public compilerVersion?: string;
  public compilationTarget?: {
    name: string;
    path: string;
  };
  public creationCodeCborAuxdata?: CompiledContractCborAuxdata;
  public runtimeCodeCborAuxdata?: CompiledContractCborAuxdata;

  constructor(
    public compiler: ISolidityCompiler | IVyperCompiler,
    public database: Database,
    public address: string,
    public chainId: number,
  ) {
    if (!this.database.isPoolInitialized()) {
      logger.error("DatabaseCompilation: database pool not initialized");
      throw new Error("DatabaseCompilation: database pool not initialized");
    }
  }

  async extractCompilationProperties() {
    try {
      // Fetch compilation data from the database
      const verifiedContractResult =
        await this.database.getSourcifyMatchByChainAddressWithProperties(
          this.chainId,
          bytesFromString(this.address),
          [
            "std_json_input",
            "std_json_output",
            "runtime_cbor_auxdata",
            "creation_cbor_auxdata",
            "metadata",
            "compiler",
          ],
        );

      if (verifiedContractResult.rows.length === 0) {
        logger.error("DatabaseCompilation: verified contract not found", {
          chainId: this.chainId,
          address: this.address,
        });
        throw new Error("Verified contract not found");
      }

      const verifiedContract = verifiedContractResult.rows[0];

      // Extract properties from the verified contract
      this.compilerVersion = verifiedContract.compiler;

      this.creationCodeCborAuxdata =
        verifiedContract.creation_cbor_auxdata || undefined;
      this.runtimeCodeCborAuxdata =
        verifiedContract.runtime_cbor_auxdata || undefined;

      // Get the file path and contract name from fully_qualified_name
      const metadataCompilationTarget = (verifiedContract.metadata as Metadata)
        .settings.compilationTarget;
      this.compilationTarget = {
        name: Object.values(metadataCompilationTarget)[0],
        path: Object.keys(metadataCompilationTarget)[0],
      };

      // Set the JSON input and output
      this.jsonInput = verifiedContract.std_json_input;
      this.jsonOutput = verifiedContract.std_json_output;
    } catch (error) {
      logger.error(
        "DatabaseCompilation: error extracting compilation properties",
        {
          error: error,
          chainId: this.chainId,
          address: this.address,
        },
      );
      throw error;
    }
  }

  async createCompilation(): Promise<PreRunCompilation> {
    await this.extractCompilationProperties();

    if (
      !this.compilerVersion ||
      !this.jsonInput ||
      !this.jsonOutput ||
      !this.compilationTarget ||
      !this.creationCodeCborAuxdata ||
      !this.runtimeCodeCborAuxdata
    ) {
      logger.error("DatabaseCompilation: compilation properties not found", {
        chainId: this.chainId,
        address: this.address,
      });
      throw new Error("Compilation properties not found");
    }

    const compilation = new PreRunCompilation(
      this.compiler,
      this.compilerVersion,
      this.jsonInput,
      this.jsonOutput,
      this.compilationTarget,
      this.creationCodeCborAuxdata,
      this.runtimeCodeCborAuxdata,
    );
    return compilation;
  }
}
