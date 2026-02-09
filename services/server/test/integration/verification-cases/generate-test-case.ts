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
 */

import readline from "readline";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import treeKill from "tree-kill";
import { JsonRpcProvider, Network } from "ethers";
import type { JsonRpcSigner } from "ethers";
import { useSolidityCompiler } from "@ethereum-sourcify/compilers";
import type {
  SolidityOutput,
  SolidityOutputContract,
} from "@ethereum-sourcify/compilers-types";
import type { Metadata } from "@ethereum-sourcify/lib-sourcify";
import type { VerificationTestCase } from "./verification-cases.spec";

const solcRepoPath = "/tmp/solc-bin/linux-amd64";
const solJsonRepoPath = "/tmp/solc-bin/soljson";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisify readline question
function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Helper to read multiline JSON input
async function readJsonInput(prompt: string): Promise<any> {
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

// Start Hardhat network
function startHardhatNetwork(port: number): Promise<ChildProcess> {
  return new Promise((resolve) => {
    const hardhatNodeProcess = spawn("npx", [
      "hardhat",
      "node",
      "--port",
      port.toString(),
    ]);

    hardhatNodeProcess.stderr.on("data", (data: Buffer) => {
      console.error(`Hardhat Network Error: ${data.toString()}`);
    });

    hardhatNodeProcess.stdout.on("data", (data: Buffer) => {
      const output = data.toString();
      process.stdout.write(output);
      if (output.includes("Started HTTP and WebSocket JSON-RPC server at")) {
        resolve(hardhatNodeProcess);
      }
    });
  });
}

// Stop Hardhat network
function stopHardhatNetwork(hardhatNodeProcess: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!hardhatNodeProcess.pid) {
      resolve();
      return;
    }
    treeKill(hardhatNodeProcess.pid, "SIGTERM", (err) => {
      if (err) {
        console.error(`Failed to kill process tree: ${err}`);
        reject(err);
      } else {
        resolve();
      }
    });
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

// Extract contract output from compilation
function extractContractOutput(
  output: SolidityOutput,
  contractIdentifier: string,
): SolidityOutputContract {
  const [sourcePath, contractName] = contractIdentifier.split(":");
  const contract = output.contracts[sourcePath]?.[contractName];
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
  const metadata: Metadata = JSON.parse(contractOutput.metadata);

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
    );

    const deploymentCompilerVersion = await question(
      "Enter the compiler version (e.g., '0.8.18+commit.87f61d96'): ",
    );
    const deploymentContractIdentifier = await question(
      "Enter the contract identifier (e.g., 'contracts/Storage.sol:Storage'): ",
    );

    console.log();
    console.log("Compiling deployment contract...");

    // Step 2: Compile and get constructor args
    console.log();
    console.log("STEP 2: Compilation & Constructor Arguments");
    console.log("-".repeat(80));

    const deploymentOutput = await useSolidityCompiler(
      solcRepoPath,
      solJsonRepoPath,
      deploymentCompilerVersion.trim(),
      deploymentStdJsonInput,
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

    const constructorArgs = await question(
      "Enter constructor arguments (ABI-encoded hex string, or press Enter for none): ",
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
      );
      verificationCompilerVersion = await question(
        "Enter the compiler version for verification: ",
      );
      verificationContractIdentifier = await question(
        "Enter the contract identifier for verification: ",
      );
    }

    // Step 5: Compile verification input
    console.log();
    console.log("STEP 5: Verification Compilation");
    console.log("-".repeat(80));
    console.log("Compiling verification contract...");

    const verificationOutput = await useSolidityCompiler(
      solcRepoPath,
      solJsonRepoPath,
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

    // Step 6: Get test case description and filename
    console.log();
    console.log("STEP 6: Test Case Description & Output");
    console.log("-".repeat(80));

    const testCaseDescription = await question(
      "What verification case is tested by your new test?\n(This will be used for the _comment field): ",
    );

    const filename = await question(
      "Enter a filename for this test case (without .json extension,\ne.g., 'constructor_args_with_libraries'): ",
    );

    // Build the test case
    // Remove outputSelection from settings as it's not part of the test case
    const cleanedStdJsonInput = { ...verificationStdJsonInput };
    if (cleanedStdJsonInput.settings?.outputSelection) {
      cleanedStdJsonInput.settings = { ...cleanedStdJsonInput.settings };
      delete cleanedStdJsonInput.settings.outputSelection;
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
      output: testCaseOutput,
      verification: {
        creationMatch: "exact_match", // User must fill
        runtimeMatch: "exact_match", // User must fill
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
    console.log("NEXT STEPS - Manual completion required:");
    console.log();
    console.log("1. Fill in the verification section:");
    console.log('   - verification.creationMatch ("exact_match", or "match")');
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
