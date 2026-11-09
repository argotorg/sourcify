#!/usr/bin/env ts-node

/**
 * Test Case Generator for verification-cases.spec.ts
 *
 * This interactive CLI tool helps generate test cases by:
 * 1. Compiling Solidity contracts with provided stdJsonInput
 * 2. Deploying them to a local Hardhat network
 * 3. Extracting bytecode and artifacts
 * 4. Creating a JSON test data file with most fields auto-filled
 *
 * The user only needs to manually fill in the verification section and cborAuxdata fields.
 *
 * Pass a JSON file with the answers to skip the prompts, e.g. to regenerate the
 * Solar fixtures: `npx ts-node generate-test-case.ts testdata/solar/generator/full_match.json`
 */

import readline from "readline";
import fs from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import type { ChildProcess } from "child_process";
import {
  startHardhatNetwork,
  stopHardhatNetwork,
} from "@ethereum-sourcify/test-helpers";
import { JsonRpcProvider, Network } from "ethers";
import type { JsonRpcSigner } from "ethers";
import {
  useSolidityCompiler,
  useSolarCompiler,
} from "@ethereum-sourcify/compilers";
import type {
  SolidityOutput,
  SolidityOutputContract,
  SolidityJsonInput,
} from "@ethereum-sourcify/compilers-types";
import type {
  Metadata,
  ISolidityCompiler,
} from "@ethereum-sourcify/lib-sourcify";
import {
  Verification,
  SolidityCompilation,
  SolarCompilation,
  DEFAULT_OUTPUT_SELECTION_FIELDS,
  SOLAR_OUTPUT_SELECTION_FIELDS,
  isSolarVersion,
} from "@ethereum-sourcify/lib-sourcify";
import type { VerificationTestCase } from "./verification-cases.spec";
import { toMatchLevel } from "../../../src/server/services/utils/util";
import SourcifyChainMock from "../../../src/server/services/utils/SourcifyChainMock";

const solcRepoPath = "/tmp/solc-bin/linux-amd64";
const solJsonRepoPath = "/tmp/solc-bin/soljson";
const solarRepoPath = "/tmp/solar-bin";

// Optional answers file, keyed by the names passed to question() and readJsonInput()
const answers: Record<string, any> | undefined = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], "utf8"))
  : undefined;

function answer(key: string): any {
  if (!(key in answers!)) {
    throw new Error(`Missing answer "${key}" in ${process.argv[2]}`);
  }
  console.log(`${key}: ${JSON.stringify(answers![key]).slice(0, 80)}`);
  return structuredClone(answers![key]);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisify readline question
function question(query: string, key: string): Promise<string> {
  if (answers) return Promise.resolve(answer(key));
  return new Promise((resolve) => rl.question(query, resolve));
}

// Compiles with Solar when the version names a Solar build
async function compile(
  version: string,
  input: SolidityJsonInput,
  forceEmscripten = false,
): Promise<SolidityOutput> {
  if (isSolarVersion(version)) {
    return await useSolarCompiler(solarRepoPath, version, input);
  }
  return await useSolidityCompiler(
    solcRepoPath,
    solJsonRepoPath,
    version,
    input,
    forceEmscripten,
  );
}

// Helper to read multiline JSON input
async function readJsonInput(prompt: string, key: string): Promise<any> {
  if (answers) return answer(key);
  console.log(prompt);
  console.log("Paste your JSON (press Enter on an empty line when done):");
  console.log();

  return new Promise((resolve, reject) => {
    let jsonStr = "";

    const onLine = (line: string) => {
      // If we get an empty line after already having content, we're done
      if (line.trim() === "" && jsonStr.trim() !== "") {
        rl.removeListener("line", onLine);
        try {
          resolve(JSON.parse(jsonStr));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e}`));
        }
      } else {
        jsonStr += line + "\n";
      }
    };

    rl.on("line", onLine);
  });
}

// Deploy from bytecode and get deployment info
type DeploymentInfo = {
  contractAddress: string;
  txHash: string;
  blockNumber: number;
  txIndex: number;
};

async function deployFromBytecode(
  signer: JsonRpcSigner,
  bytecode: string,
): Promise<DeploymentInfo> {
  console.log(`Deploying contract from bytecode`);
  const tx = await signer.sendTransaction({
    data: bytecode,
  });
  const receipt = await tx.wait();

  if (!receipt || !receipt.contractAddress) {
    throw new Error("Contract deployment failed");
  }

  if (receipt.blockNumber === null) {
    throw new Error("Block number is null");
  }

  return {
    contractAddress: receipt.contractAddress,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    txIndex: receipt.index,
  };
}

// Get signer for local Hardhat network (chain ID 31337)
async function getLocalSigner(port: number): Promise<JsonRpcSigner> {
  const ethersNetwork = new Network("hardhat", 31337);
  return await new JsonRpcProvider(`http://localhost:${port}`, ethersNetwork, {
    staticNetwork: ethersNetwork,
  }).getSigner();
}

// Compiler wrapper to use with lib-sourcify classes
class SolcCompilerWrapper implements ISolidityCompiler {
  async compile(
    version: string,
    solcJsonInput: SolidityJsonInput,
  ): Promise<SolidityOutput> {
    return await compile(version, solcJsonInput, true);
  }
}

// Extract contract output from compilation
function extractContractOutput(
  output: SolidityOutput,
  contractIdentifier: string,
): SolidityOutputContract {
  const [sourcePath, contractName] = contractIdentifier.split(":");
  const contract =
    output.contracts[sourcePath]?.[contractName] ||
    // In solidity versions < 0.4.9, the source path is empty string
    output.contracts[""]?.[contractName];
  if (!contract) {
    throw new Error(
      `Contract ${contractIdentifier} not found in compilation output`,
    );
  }
  return contract;
}

// Map compiler output to VerificationTestCase.output format
function mapToTestCaseOutput(
  contractOutput: SolidityOutputContract,
  output: SolidityOutput,
) {
  // Extract metadata
  let metadata: Metadata | undefined = undefined;

  if (contractOutput.metadata) {
    metadata = JSON.parse(contractOutput.metadata);
  }

  // Build compilation artifacts sources
  const compilationArtifactsSources: any = {};
  if (output.sources) {
    for (const [path, source] of Object.entries(output.sources)) {
      compilationArtifactsSources[path] = { id: source.id };
    }
  }

  return {
    creationBytecode: "0x" + contractOutput.evm.bytecode.object,
    deployedBytecode: "0x" + contractOutput.evm.deployedBytecode.object,
    compilationArtifacts: {
      abi: contractOutput.abi,
      devdoc: contractOutput.devdoc || null,
      userdoc: contractOutput.userdoc || null,
      storageLayout: contractOutput.storageLayout || null,
      transientStorageLayout: contractOutput.transientStorageLayout || null,
      sources: compilationArtifactsSources,
    },
    creationCodeArtifacts: {
      linkReferences: contractOutput.evm.bytecode.linkReferences || null,
      sourceMap: contractOutput.evm.bytecode.sourceMap || null,
      cborAuxdata: {}, // User must fill manually
    },
    runtimeCodeArtifacts: {
      immutableReferences:
        contractOutput.evm.deployedBytecode.immutableReferences || null,
      linkReferences:
        contractOutput.evm.deployedBytecode.linkReferences || null,
      sourceMap: contractOutput.evm.deployedBytecode.sourceMap || null,
      cborAuxdata: {}, // User must fill manually
    },
    metadata,
  };
}

// Main script
async function main() {
  console.log("=".repeat(80));
  console.log("Testdata Generator for Verification Cases");
  console.log("=".repeat(80));
  console.log();
  console.log(
    "This script helps you generate testdata for specific verification cases (verification-cases.spec.ts).",
  );
  console.log(
    "It will compile your contract, deploy it to a local Hardhat network,",
  );
  console.log("and create a JSON test data file with most fields auto-filled.");
  console.log();
  console.log(
    "Note: This script only works for Solidity contracts at the moment.",
  );
  console.log();

  let hardhatProcess: ChildProcess | undefined;

  try {
    // Step 1: Get deployment stdJsonInput
    console.log("STEP 1: Deployment Input");
    console.log("-".repeat(80));
    const deploymentStdJsonInput = await readJsonInput(
      "Please provide the stdJsonInput that leads to the deployed contract code.\nMake sure to include linked library addresses if your contract uses libraries.",
      "deploymentStdJsonInput",
    );

    const deploymentCompilerVersion = await question(
      "Enter the compiler version (e.g., '0.8.18+commit.87f61d96'): ",
      "deploymentCompilerVersion",
    );
    const deploymentContractIdentifier = await question(
      "Enter the contract identifier (e.g., 'contracts/Storage.sol:Storage'): ",
      "deploymentContractIdentifier",
    );

    console.log();
    console.log("Compiling deployment contract...");

    // Step 2: Compile and get constructor args
    console.log();
    console.log("STEP 2: Compilation & Constructor Arguments");
    console.log("-".repeat(80));

    const deploymentOutput = await compile(
      deploymentCompilerVersion.trim(),
      deploymentStdJsonInput,
      true,
    );

    if (deploymentOutput.errors?.some((e) => e.severity === "error")) {
      console.error("Compilation errors:");
      deploymentOutput.errors
        .filter((e) => e.severity === "error")
        .forEach((e) => console.error(e.formattedMessage));
      throw new Error("Compilation failed");
    }

    const deploymentContract = extractContractOutput(
      deploymentOutput,
      deploymentContractIdentifier.trim(),
    );

    let creationBytecode = "0x" + deploymentContract.evm.bytecode.object;

    // Placeholders are replaced like a manual link, e.g. {"__$...$__": "<address>"}
    if (answers?.linkLibraries) {
      for (const [placeholder, address] of Object.entries(
        answers.linkLibraries as Record<string, string>,
      )) {
        creationBytecode = creationBytecode
          .split(placeholder)
          .join(address.replace(/^0x/, "").toLowerCase());
      }
    }

    const constructorArgs = await question(
      "Enter constructor arguments (ABI-encoded hex string, or press Enter for none): ",
      "constructorArgs",
    );

    if (constructorArgs.trim()) {
      const args = constructorArgs.trim().startsWith("0x")
        ? constructorArgs.trim().slice(2)
        : constructorArgs.trim();
      creationBytecode = creationBytecode + args;
    }

    console.log(
      "Creation bytecode prepared:",
      creationBytecode.slice(0, 66) + "...",
    );

    // Step 3: Deploy to local chain
    console.log();
    console.log("STEP 3: Local Chain Deployment");
    console.log("-".repeat(80));
    console.log("Starting Hardhat network...");

    const HARDHAT_PORT = 8545;
    hardhatProcess = await startHardhatNetwork(HARDHAT_PORT);
    console.log("Hardhat network started on port", HARDHAT_PORT);

    const signer = await getLocalSigner(HARDHAT_PORT);
    console.log("Deploying contract...");

    const deploymentInfo = await deployFromBytecode(signer, creationBytecode);

    console.log("Contract deployed at:", deploymentInfo.contractAddress);

    // Query deployed bytecode (includes immutables)
    const deployedBytecode = await signer.provider.getCode(
      deploymentInfo.contractAddress,
    );
    console.log(
      "Deployed bytecode retrieved (includes immutables):",
      deployedBytecode.slice(0, 66) + "...",
    );

    // Stop Hardhat
    console.log("Stopping Hardhat network...");
    await stopHardhatNetwork(hardhatProcess);
    hardhatProcess = undefined;
    console.log("Hardhat network stopped.");

    // Step 4: Get verification input
    console.log();
    console.log("STEP 4: Verification Input");
    console.log("-".repeat(80));

    const reuseInput = await question(
      "Should the same stdJsonInput, compilerVersion and contractIdentifier be used for\nthe verification in the test case? If you want the test case to verify via a\nmodified stdJsonInput, say no. (Y/n): ",
      "reuseInput",
    );

    let verificationStdJsonInput = deploymentStdJsonInput;
    let verificationCompilerVersion = deploymentCompilerVersion;
    let verificationContractIdentifier = deploymentContractIdentifier;

    // Default to yes if empty input or yes/y
    const shouldReuse =
      reuseInput.trim() === "" ||
      reuseInput.toLowerCase() === "y" ||
      reuseInput.toLowerCase() === "yes";

    if (!shouldReuse) {
      console.log();
      verificationStdJsonInput = await readJsonInput(
        "Please provide the stdJsonInput for verification:",
        "verificationStdJsonInput",
      );
      verificationCompilerVersion = await question(
        "Enter the compiler version for verification: ",
        "verificationCompilerVersion",
      );
      verificationContractIdentifier = await question(
        "Enter the contract identifier for verification: ",
        "verificationContractIdentifier",
      );
    }

    // Step 5: Compile verification input
    console.log();
    console.log("STEP 5: Verification Compilation");
    console.log("-".repeat(80));
    console.log("Compiling verification contract...");

    // The generator compiles directly via useSolidityCompiler (bypassing the
    // SolidityCompilation class, which scopes output to the target), so it
    // requests full output for every contract to build a complete fixture, hence the "*": "*" selection.
    const isSolar = isSolarVersion(verificationCompilerVersion.trim());
    verificationStdJsonInput.settings.outputSelection = {
      "*": {
        "*": isSolar
          ? [...SOLAR_OUTPUT_SELECTION_FIELDS]
          : [...DEFAULT_OUTPUT_SELECTION_FIELDS],
      },
    };

    const verificationOutput = await compile(
      verificationCompilerVersion.trim(),
      verificationStdJsonInput,
    );

    if (verificationOutput.errors?.some((e) => e.severity === "error")) {
      console.error("Compilation errors:");
      verificationOutput.errors
        .filter((e) => e.severity === "error")
        .forEach((e) => console.error(e.formattedMessage));
      throw new Error("Verification compilation failed");
    }

    const verificationContract = extractContractOutput(
      verificationOutput,
      verificationContractIdentifier.trim(),
    );

    const testCaseOutput = mapToTestCaseOutput(
      verificationContract,
      verificationOutput,
    );

    // Step 5.5: Ask if user wants to auto-generate verification results
    console.log();
    console.log("STEP 5.5: Auto-generate Verification Results (Optional)");
    console.log("-".repeat(80));

    const generateVerification = await question(
      "Do you want to generate verification results too? If you do so, please make sure to\nMANUALLY CHECK the data inside the cborAuxdata and verification fields very thoroughly. (Y/n): ",
      "generateVerification",
    );

    // Default to yes if empty input or yes/y
    const shouldGenerateVerification =
      generateVerification.trim() === "" ||
      generateVerification.toLowerCase() === "y" ||
      generateVerification.toLowerCase() === "yes";

    let verificationGenerated = false;
    let verificationData: VerificationTestCase["verification"] | null = null;
    let cborAuxdataData: {
      creation: any;
      runtime: any;
    } | null = null;

    if (shouldGenerateVerification) {
      try {
        console.log("Generating verification results...");

        // Create SolidityCompilation instance
        const solcWrapper = new SolcCompilerWrapper();
        const [sourcePath, contractName] = verificationContractIdentifier
          .trim()
          .split(":");

        const compilation = new (
          isSolar ? SolarCompilation : SolidityCompilation
        )(
          solcWrapper,
          verificationCompilerVersion.trim(),
          verificationStdJsonInput,
          { path: sourcePath, name: contractName },
        );

        // Create SourcifyChainMock with the deployment data
        const mockChain = new SourcifyChainMock(
          {
            onchain_runtime_code: deployedBytecode,
            onchain_creation_code: creationBytecode,
            block_number: deploymentInfo.blockNumber,
            transaction_index: deploymentInfo.txIndex,
            deployer: undefined,
            transaction_hash: deploymentInfo.txHash,
          },
          31337, // Hardhat chainId
          deploymentInfo.contractAddress,
        );

        // Create and run verification
        const verification = new Verification(
          compilation,
          mockChain,
          deploymentInfo.contractAddress,
          deploymentInfo.txHash,
        );

        await verification.verify();
        const verificationExport = verification.export();

        // Extract verification data using toMatchLevel helper
        verificationData = {
          creationMatch: toMatchLevel(verificationExport.status.creationMatch),
          runtimeMatch: toMatchLevel(verificationExport.status.runtimeMatch),
          creationTransformations:
            verificationExport.transformations.creation.list,
          creationValues: verificationExport.transformations.creation.values,
          runtimeTransformations:
            verificationExport.transformations.runtime.list,
          runtimeValues: verificationExport.transformations.runtime.values,
        };

        // Extract cborAuxdata
        cborAuxdataData = {
          creation:
            verificationExport.compilation.creationBytecodeCborAuxdata || {},
          runtime:
            verificationExport.compilation.runtimeBytecodeCborAuxdata || {},
        };

        verificationGenerated = true;
        console.log("Verification results generated successfully!");
        console.log(`  - Creation Match: ${verificationData.creationMatch}`);
        console.log(`  - Runtime Match: ${verificationData.runtimeMatch}`);
      } catch (error: any) {
        console.error(
          "Failed to generate verification results:",
          error.message,
        );
        console.log("Please create verification data fields manually.");
        verificationGenerated = false;
      }
    }

    // Step 6: Get test case description and filename
    console.log();
    console.log("STEP 6: Test Case Description & Output");
    console.log("-".repeat(80));

    const testCaseDescription = await question(
      "What verification case is tested by your new test?\n(This will be used for the _comment field): ",
      "testCaseDescription",
    );

    const filename = await question(
      "Enter a filename for this test case (without .json extension,\ne.g., 'constructor_args_with_libraries'): ",
      "filename",
    );

    // Build the test case
    // Remove outputSelection from settings as it's not part of the test case
    const cleanedStdJsonInput = { ...verificationStdJsonInput };
    if (cleanedStdJsonInput.settings?.outputSelection) {
      cleanedStdJsonInput.settings = { ...cleanedStdJsonInput.settings };
      delete cleanedStdJsonInput.settings.outputSelection;
    }

    // Update cborAuxdata if verification was generated
    const finalTestCaseOutput = { ...testCaseOutput };
    if (verificationGenerated && cborAuxdataData) {
      finalTestCaseOutput.creationCodeArtifacts.cborAuxdata =
        cborAuxdataData.creation;
      finalTestCaseOutput.runtimeCodeArtifacts.cborAuxdata =
        cborAuxdataData.runtime;
    }

    // Sourcify stores library placeholders as zero addresses
    const zeroLibraries = (bytecode: string, transformations: any[]) =>
      transformations
        .filter((t) => t.reason === "library")
        .reduce(
          (code: string, t) =>
            code.slice(0, 2 + t.offset * 2) +
            "0".repeat(40) +
            code.slice(2 + t.offset * 2 + 40),
          bytecode,
        );
    if (verificationGenerated && verificationData) {
      finalTestCaseOutput.creationBytecode = zeroLibraries(
        finalTestCaseOutput.creationBytecode,
        verificationData.creationTransformations,
      );
      finalTestCaseOutput.deployedBytecode = zeroLibraries(
        finalTestCaseOutput.deployedBytecode,
        verificationData.runtimeTransformations,
      );
    }

    const testCase: VerificationTestCase = {
      onchain: {
        creationBytecode,
        deployedBytecode,
      },
      input: {
        stdJsonInput: cleanedStdJsonInput,
        compilerVersion: verificationCompilerVersion.trim(),
        contractIdentifier: verificationContractIdentifier.trim(),
      },
      output: finalTestCaseOutput,
      verification:
        verificationGenerated && verificationData
          ? verificationData
          : {
              creationMatch: "exact_match" as any, // User must fill
              runtimeMatch: "exact_match" as any, // User must fill
              creationTransformations: [],
              creationValues: {},
              runtimeTransformations: [],
              runtimeValues: {},
            },
    };

    // Create output JSON with _comment
    const outputJson = {
      _comment: testCaseDescription.trim(),
      ...testCase,
    };

    // Write to file
    const outputPath = path.join(
      __dirname,
      "testdata",
      `${filename.trim()}.json`,
    );
    await fs.writeFile(outputPath, JSON.stringify(outputJson, null, 2));

    console.log();
    console.log("=".repeat(80));
    console.log("SUCCESS!");
    console.log("=".repeat(80));
    console.log();
    console.log("Test case file created:");
    console.log(outputPath);
    console.log();

    if (verificationGenerated) {
      console.log("NEXT STEPS - Manual verification required:");
      console.log();
      console.log(
        "IMPORTANT: The verification and cborAuxdata fields were auto-generated. This means these",
      );
      console.log(
        "fields are generated by the code you want to actually test. You MUST manually verify",
      );
      console.log(
        "the following fields very thoroughly before using this test case:",
      );
      console.log();
      console.log("1. Verify the verification section is correct:");
      console.log("   - verification.creationMatch");
      console.log("   - verification.runtimeMatch");
      console.log("   - verification.creationTransformations");
      console.log("   - verification.creationValues");
      console.log("   - verification.runtimeTransformations");
      console.log("   - verification.runtimeValues");
      console.log();
      console.log("2. Verify the cborAuxdata fields are correct:");
      console.log("   - output.creationCodeArtifacts.cborAuxdata");
      console.log("   - output.runtimeCodeArtifacts.cborAuxdata");
      console.log();
      console.log("3. Add test case to verification-cases.spec.ts");
    } else {
      console.log("NEXT STEPS - Manual completion required:");
      console.log();
      console.log("1. Fill in the verification section:");
      console.log(
        '   - verification.creationMatch ("exact_match", or "match")',
      );
      console.log("   - verification.runtimeMatch");
      console.log("   - verification.creationTransformations");
      console.log("   - verification.creationValues");
      console.log("   - verification.runtimeTransformations");
      console.log("   - verification.runtimeValues");
      console.log();
      console.log("2. Fill in the empty cborAuxdata fields:");
      console.log("   - output.creationCodeArtifacts.cborAuxdata");
      console.log("   - output.runtimeCodeArtifacts.cborAuxdata");
      console.log();
      console.log("3. Add test case to verification-cases.spec.ts");
    }
    console.log();
    console.log("=".repeat(80));
  } catch (error) {
    console.error("Error:", error);
    if (hardhatProcess) {
      console.log("Cleaning up Hardhat process...");
      await stopHardhatNetwork(hardhatProcess);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
