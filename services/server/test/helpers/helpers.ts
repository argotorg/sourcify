import type {
  JsonRpcSigner,
  JsonFragment,
  JsonRpcProvider,
  BytesLike,
} from "ethers";
import { ContractFactory, Wallet, Contract, getAddress } from "ethers";
import type { SourcifyDatabaseService } from "../../src/server/services/storageServices/SourcifyDatabaseService";
import { MockVerificationExport } from "./mocks";
import { assertVerification } from "./assertions";
import chai, { expect } from "chai";
import chaiHttp from "chai-http";
import path from "path";
import { promises as fs } from "fs";
import type { ServerFixture } from "./ServerFixture";
import type { Done } from "mocha";
import type { LocalChainFixture } from "./LocalChainFixture";
import type { Pool } from "pg";
import sinon from "sinon";
import type { VerificationStatus } from "@ethereum-sourcify/lib-sourcify";

chai.use(chaiHttp);

export const invalidAddress = "0x000000bCB92160f8B7E094998Af6BCaD7fa537ff"; // checksum false
export const unusedAddress = "0xf1Df8172F308e0D47D0E5f9521a5210467408535";
export const unsupportedChain = "3"; // Ropsten

export async function deployFromAbiAndBytecode(
  signer: JsonRpcSigner,
  abi: JsonFragment[],
  bytecode: BytesLike | { object: string },
  args?: any[],
) {
  const contractFactory = new ContractFactory(abi, bytecode, signer);
  console.log(`Deploying contract ${args?.length ? `with args ${args}` : ""}`);
  const deployment = await contractFactory.deploy(...(args || []));
  await deployment.waitForDeployment();

  const contractAddress = await deployment.getAddress();
  console.log(`Deployed contract at ${contractAddress}`);
  return contractAddress;
}

export type DeploymentInfo = {
  contractAddress: string;
  txHash: string;
  blockNumber: number;
  txIndex: number;
};

/**
 * Creator tx hash is needed for tests. This function returns the tx hash in addition to the contract address.
 *
 */
export async function deployFromAbiAndBytecodeForCreatorTxHash(
  signer: JsonRpcSigner,
  abi: JsonFragment[] | undefined,
  bytecode: BytesLike | { object: string },
  args?: any[],
): Promise<DeploymentInfo> {
  const contractFactory = new ContractFactory(abi || [], bytecode, signer);
  console.log(`Deploying contract ${args?.length ? `with args ${args}` : ""}`);
  const deployment = await contractFactory.deploy(...(args || []));
  await deployment.waitForDeployment();

  const contractAddress = await deployment.getAddress();
  const creationTx = deployment.deploymentTransaction();
  if (!creationTx) {
    throw new Error(`No deployment transaction found for ${contractAddress}`);
  }
  if (creationTx.blockNumber === null) {
    throw new Error(
      `No block number found for deployment transaction ${creationTx.hash}. Block number: ${creationTx.blockNumber}`,
    );
  }
  console.log(
    `Deployed contract at ${contractAddress} with tx ${creationTx.hash}`,
  );

  return {
    contractAddress,
    txHash: creationTx.hash,
    blockNumber: creationTx.blockNumber,
    txIndex: creationTx.index,
  };
}

/**
 * Takes the creation bytecode as it is and runs it in a transaction.
 * Assumes that constructor arguments are already appended.
 */
export async function deployFromBytecodeForCreatorTxHash(
  signer: JsonRpcSigner,
  bytecode: string,
): Promise<DeploymentInfo> {
  console.log(`Deploying contract from bytecode`);
  const tx = await signer.sendTransaction({
    data: bytecode,
  });
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error(`No receipt found for transaction ${tx.hash}`);
  }
  if (!receipt.contractAddress) {
    throw new Error(
      `No contract address found in receipt for transaction ${tx.hash}`,
    );
  }
  if (receipt.blockNumber === null) {
    throw new Error(
      `No block number found for deployment transaction ${tx.hash}. Block number: ${receipt.blockNumber}`,
    );
  }
  console.log(
    `Deployed contract at ${receipt.contractAddress} with tx ${tx.hash}`,
  );

  return {
    contractAddress: receipt.contractAddress,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    txIndex: receipt.index,
  };
}

export async function verifyContract(
  serverFixture: ServerFixture,
  chainFixture: LocalChainFixture,
  contractAddress?: string,
  creatorTxHash?: string,
  partial: boolean = false,
) {
  const res = await chai
    .request(serverFixture.server.app)
    .post("/")
    .field("address", contractAddress || chainFixture.defaultContractAddress)
    .field("chain", chainFixture.chainId)
    .field(
      "creatorTxHash",
      creatorTxHash || chainFixture.defaultContractCreatorTx,
    )
    .attach(
      "files",
      partial
        ? chainFixture.defaultContractModifiedMetadata
        : chainFixture.defaultContractMetadata,
      "metadata.json",
    )
    .attach(
      "files",
      partial
        ? chainFixture.defaultContractModifiedSource
        : chainFixture.defaultContractSource,
    );
  expect(
    res.status,
    `Verification failed for ${contractAddress} on chain ${chainFixture.chainId}`,
  ).to.equal(200);
  expect(res.body.result.length).to.equal(1);
  expect(res.body.result[0].status).to.equal(partial ? "partial" : "perfect");
  expect(res.body.result[0].chainId).to.equal(chainFixture.chainId);
  if (contractAddress) {
    expect(res.body.result[0].address).to.equal(contractAddress);
  }
  return res;
}

export async function deployAndVerifyContract(
  chainFixture: LocalChainFixture,
  serverFixture: ServerFixture,
  partial: boolean = false,
) {
  const { contractAddress, txHash } =
    await deployFromAbiAndBytecodeForCreatorTxHash(
      chainFixture.localSigner,
      chainFixture.defaultContractArtifact.abi,
      chainFixture.defaultContractArtifact.bytecode,
      [],
    );
  await verifyContract(
    serverFixture,
    chainFixture,
    contractAddress,
    txHash,
    partial,
  );
  return contractAddress;
}

/**
 * Function to deploy contracts from an external account with private key
 */
export async function deployFromPrivateKey(
  provider: JsonRpcProvider,
  abi: JsonFragment[],
  bytecode: BytesLike | { object: string },
  privateKey: string,
  args?: any[],
) {
  const signer = new Wallet(privateKey, provider);
  const contractFactory = new ContractFactory(abi, bytecode, signer);
  console.log(`Deploying contract ${args?.length ? `with args ${args}` : ""}`);
  const deployment = await contractFactory.deploy(...(args || []));
  await deployment.waitForDeployment();

  const contractAddress = await deployment.getAddress();
  console.log(`Deployed contract at ${contractAddress}`);
  return contractAddress;
}

/**
 * Await `secs` seconds
 * @param  {Number} secs seconds
 * @return {Promise}
 */
export function waitSecs(secs = 0) {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000));
}

// Uses staticCall which does not send a tx i.e. change the state.
export async function callContractMethod(
  provider: JsonRpcProvider,
  abi: JsonFragment[],
  contractAddress: string,
  methodName: string,
  args: any[],
) {
  const contract = new Contract(contractAddress, abi, provider);
  const callResponse = await contract[methodName].staticCall(...args);

  return callResponse;
}

// Sends a tx that changes the state
export async function callContractMethodWithTx(
  signer: JsonRpcSigner,
  abi: JsonFragment[],
  contractAddress: string,
  methodName: string,
  args: any[],
) {
  const contract = new Contract(contractAddress, abi, signer);
  const txResponse = await contract[methodName].send(...args);
  const txReceipt = await txResponse.wait();
  return txReceipt;
}

export function verifyAndAssertEtherscanViaApiV1(
  serverFixture: ServerFixture,
  chainId: string,
  address: string,
  expectedStatus: VerificationStatus,
  done: Done,
  metadataExpected: boolean = true,
) {
  const request = chai
    .request(serverFixture.server.app)
    .post("/verify/etherscan")
    .field("address", address)
    .field("chain", chainId);
  request.end(async (err, res) => {
    await assertVerification(
      serverFixture,
      err,
      res,
      done,
      address,
      chainId,
      expectedStatus,
      metadataExpected,
    );
  });
}

export async function readFilesFromDirectory(dirPath: string) {
  try {
    const filesContent: Record<string, string> = {};
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        const content = await fs.readFile(filePath, "utf8");
        filesContent[file] = content;
      }
    }
    return filesContent;
  } catch (error) {
    console.error("Error reading files from directory:", error);
    throw error;
  }
}

export async function resetDatabase(sourcifyDatabase: Pool) {
  if (!sourcifyDatabase) {
    chai.assert.fail("Database pool not configured");
  }
  await sourcifyDatabase.query("DELETE FROM verification_jobs");
  await sourcifyDatabase.query("DELETE FROM verification_jobs_ephemeral");
  await sourcifyDatabase.query("DELETE FROM sourcify_sync");
  await sourcifyDatabase.query("DELETE FROM sourcify_matches");
  // Needed for matchId to be deterministic in tests
  await sourcifyDatabase.query(
    "ALTER SEQUENCE sourcify_matches_id_seq RESTART WITH 1",
  );
  await sourcifyDatabase.query(
    "ALTER SEQUENCE verified_contracts_id_seq RESTART WITH 1",
  );
  await sourcifyDatabase.query("DELETE FROM verified_contracts");
  await sourcifyDatabase.query("DELETE FROM contract_deployments");
  await sourcifyDatabase.query("DELETE FROM compiled_contracts_signatures");
  await sourcifyDatabase.query("DELETE FROM signatures");
  await sourcifyDatabase.query("DELETE FROM compiled_contracts_sources");
  await sourcifyDatabase.query("DELETE FROM sources");
  await sourcifyDatabase.query("DELETE FROM compiled_contracts");
  await sourcifyDatabase.query("DELETE FROM contracts");
  await sourcifyDatabase.query("DELETE FROM code");
}

/**
 * Should be called inside a describe block.
 * @returns a function that can be called in it blocks to make the verification workers wait.
 */
export function hookIntoVerificationWorkerRun(
  sandbox: sinon.SinonSandbox,
  serverFixture: ServerFixture,
) {
  let fakeResolvers: (() => Promise<void>)[] = [];

  beforeEach(() => {
    fakeResolvers = [];
  });

  afterEach(async () => {
    await Promise.all(fakeResolvers.map((resolver) => resolver()));
  });

  const makeWorkersWait = () => {
    const fakePromise = sinon.promise();
    const workerPool = serverFixture.server.services.verification["workerPool"];
    const originalRun = workerPool.run;
    const runTaskStub = sandbox
      .stub(workerPool, "run")
      .callsFake(async (...args) => {
        await fakePromise;
        return originalRun.apply(workerPool, args);
      }) as sinon.SinonStub<[any, any], Promise<any>>;

    const resolveWorkers = async () => {
      if (fakePromise.status === "pending") {
        // Start workers
        fakePromise.resolve(undefined);
      }
      // Wait for workers to complete
      await Promise.all(
        serverFixture.server.services.verification["runningTasks"],
      );
    };
    fakeResolvers.push(resolveWorkers);
    return { resolveWorkers, runTaskStub };
  };

  return makeWorkersWait;
}

/**
 * Insert a mock verified contract directly into the database.
 * Each contract gets unique bytecodes and address derived from the index
 * to satisfy the DB unique constraints, avoiding expensive on-chain
 * deployments and full verification round-trips.
 */
export async function insertMockVerification(
  databaseService: SourcifyDatabaseService,
  index: number,
  partial: boolean,
  chainId: number = 31337,
): Promise<string> {
  const hexIndex = index.toString(16).padStart(4, "0");
  const mock = structuredClone(MockVerificationExport);
  mock.address = getAddress(`0x${hexIndex}${"0".repeat(40 - hexIndex.length)}`);
  mock.chainId = chainId;
  mock.onchainRuntimeBytecode = `0x${"aa".repeat(32)}${hexIndex}`;
  mock.onchainCreationBytecode = `0x${"bb".repeat(32)}${hexIndex}`;
  mock.compilation.runtimeBytecode = `0x${"cc".repeat(32)}${hexIndex}`;
  mock.compilation.creationBytecode = `0x${"dd".repeat(32)}${hexIndex}`;
  mock.compilation.runtimeBytecodeCborAuxdata = {};
  mock.compilation.creationBytecodeCborAuxdata = {};
  mock.deploymentInfo.txHash = `0x${"ee".repeat(31)}${hexIndex}`;
  mock.status = partial
    ? { runtimeMatch: "partial", creationMatch: "partial" }
    : { runtimeMatch: "perfect", creationMatch: "perfect" };
  await databaseService.storeVerification(mock);
  return mock.address;
}
