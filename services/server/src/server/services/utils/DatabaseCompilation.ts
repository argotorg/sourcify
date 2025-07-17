import {
  CompiledContractCborAuxdata,
  ISolidityCompiler,
  IVyperCompiler,
  Metadata,
  PreRunCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import { bytesFromString } from "./database-util";
import { Database } from "./Database";
import logger from "../../../common/logger";

export async function extractCompilationFromDatabase(
  database: Database,
  { solc, vyper }: { solc: ISolidityCompiler; vyper: IVyperCompiler },
  address: string,
  chainId: number,
): Promise<PreRunCompilation> {
  if (!database.isPoolInitialized()) {
    logger.error(
      "extractCompilationFromDatabase: database pool not initialized",
    );
    throw new Error(
      "extractCompilationFromDatabase: database pool not initialized",
    );
  }

  try {
    // Fetch compilation data from the database
    const verifiedContractResult =
      await database.getSourcifyMatchByChainAddressWithProperties(
        chainId,
        bytesFromString(address),
        [
          "std_json_input",
          "std_json_output",
          "runtime_cbor_auxdata",
          "creation_cbor_auxdata",
          "metadata",
          "version",
        ],
      );

    if (verifiedContractResult.rows.length === 0) {
      logger.error(
        "extractCompilationFromDatabase: verified contract not found",
        {
          chainId,
          address,
        },
      );
      throw new Error("Verified contract not found");
    }

    const verifiedContract = verifiedContractResult.rows[0];

    // Extract properties from the verified contract
    const compilerVersion = verifiedContract.version;
    const creationCodeCborAuxdata: CompiledContractCborAuxdata | undefined =
      verifiedContract.creation_cbor_auxdata || undefined;
    const runtimeCodeCborAuxdata: CompiledContractCborAuxdata | undefined =
      verifiedContract.runtime_cbor_auxdata || undefined;

    // Get the file path and contract name from fully_qualified_name
    const metadataCompilationTarget = (verifiedContract.metadata as Metadata)
      .settings.compilationTarget;
    const compilationTarget = {
      name: Object.values(metadataCompilationTarget)[0],
      path: Object.keys(metadataCompilationTarget)[0],
    };

    // Set the JSON input and output
    const jsonInput = verifiedContract.std_json_input;
    const jsonOutput = verifiedContract.std_json_output;

    if (
      !compilerVersion ||
      !jsonInput ||
      !jsonOutput ||
      !compilationTarget ||
      !creationCodeCborAuxdata ||
      !runtimeCodeCborAuxdata
    ) {
      logger.error(
        "extractCompilationFromDatabase: compilation properties not found",
        {
          chainId,
          address,
        },
      );
      throw new Error("Compilation properties not found");
    }

    const compilation = new PreRunCompilation(
      jsonInput?.language === "Solidity" ? solc : vyper,
      compilerVersion,
      jsonInput,
      jsonOutput,
      compilationTarget,
      creationCodeCborAuxdata,
      runtimeCodeCborAuxdata,
    );
    return compilation;
  } catch (error) {
    logger.error(
      "extractCompilationFromDatabase: error extracting compilation properties",
      {
        error: error,
        chainId,
        address,
      },
    );
    throw error;
  }
}
