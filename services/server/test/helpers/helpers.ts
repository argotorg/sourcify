import config from "config";
import {
  ContractFactory,
  Wallet,
  JsonRpcSigner,
  Interface,
  InterfaceAbi,
  JsonRpcProvider,
  BytesLike,
  Contract,
} from "ethers";
import { assertVerificationSession, assertVerification } from "./assertions";
import chai, { expect } from "chai";
import chaiHttp from "chai-http";
import path from "path";
import { promises as fs, readFileSync } from "fs";
import { ServerFixture } from "./ServerFixture";
import type { Done } from "mocha";
import { LocalChainFixture } from "./LocalChainFixture";
import { Pool } from "pg";
import sinon from "sinon";
import { VerificationStatus } from "@ethereum-sourcify/lib-sourcify";

chai.use(chaiHttp);

export const invalidAddress = "0x000000bCB92160f8B7E094998Af6BCaD7fa537ff"; // checksum false
export const unusedAddress = "0xf1Df8172F308e0D47D0E5f9521a5210467408535";
export const unsupportedChain = "3"; // Ropsten

export async function deployFromAbiAndBytecode(
  signer: JsonRpcSigner,
  abi: Interface | InterfaceAbi,
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
  abi: Interface | InterfaceAbi,
  bytecode: BytesLike | { object: string },
  args?: any[],
): Promise<DeploymentInfo> {
  const contractFactory = new ContractFactory(abi, bytecode, signer);
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
  abi: Interface | InterfaceAbi,
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
  abi: Interface | InterfaceAbi,
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
  abi: Interface | InterfaceAbi,
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
) {
  const request = chai
    .request(serverFixture.server.app)
    .post("/verify/etherscan")
    .field("address", address)
    .field("chain", chainId);
  request.end(async (err, res) => {
    await assertVerification(
      null,
      err,
      res,
      done,
      address,
      chainId,
      expectedStatus,
    );
  });
}

export function verifyAndAssertEtherscanSession(
  serverFixture: ServerFixture,
  chainId: string,
  address: string,
  expectedStatus: VerificationStatus,
  done: Done,
) {
  chai
    .request(serverFixture.server.app)
    .post("/session/verify/etherscan")
    .field("address", address)
    .field("chainId", chainId)
    .end(async (err, res) => {
      await assertVerificationSession(
        null,
        err,
        res,
        done,
        address,
        chainId,
        expectedStatus,
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
  await sourcifyDatabase.query("DELETE FROM verified_contracts");
  await sourcifyDatabase.query("DELETE FROM contract_deployments");
  await sourcifyDatabase.query("DELETE FROM compiled_contracts_sources");
  await sourcifyDatabase.query("DELETE FROM sources");
  await sourcifyDatabase.query("DELETE FROM compiled_contracts");
  await sourcifyDatabase.query("DELETE FROM contracts");
  await sourcifyDatabase.query("DELETE FROM code");
}

export async function testPartialUpgrade(
  serverFixture: ServerFixture,
  chainFixture: LocalChainFixture,
  matchType: "creation" | "runtime",
) {
  const partialMetadata = (
    await import("../testcontracts/Storage/metadataModified.json")
  ).default;
  const partialMetadataBuffer = Buffer.from(JSON.stringify(partialMetadata));

  const partialSourcePath = path.join(
    __dirname,
    "..",
    "testcontracts",
    "Storage",
    "StorageModified.sol",
  );
  const partialSourceBuffer = readFileSync(partialSourcePath);

  let res = await chai
    .request(serverFixture.server.app)
    .post("/")
    .field("address", chainFixture.defaultContractAddress)
    .field("chain", chainFixture.chainId)
    .field("creatorTxHash", chainFixture.defaultContractCreatorTx)
    .attach("files", partialMetadataBuffer, "metadata.json")
    .attach("files", partialSourceBuffer);
  await assertVerification(
    serverFixture,
    null,
    res,
    null,
    chainFixture.defaultContractAddress,
    chainFixture.chainId,
    "partial",
  );

  const contractMatchesWithPartialMetadata =
    await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_match, creation_match FROM sourcify_matches;",
    );

  chai
    .expect(contractMatchesWithPartialMetadata.rows[0].runtime_match)
    .to.equal("partial");
  chai
    .expect(contractMatchesWithPartialMetadata.rows[0].creation_match)
    .to.equal("partial");

  const contractDeploymentWithoutCreatorTransactionHash =
    await serverFixture.sourcifyDatabase.query(
      "SELECT encode(transaction_hash, 'hex') as transaction_hash, block_number, transaction_index, contract_id FROM contract_deployments",
    );
  const contractIdWithoutCreatorTransactionHash =
    contractDeploymentWithoutCreatorTransactionHash?.rows[0].contract_id;

  // Force perfect ${matchType}Match by setting sourcify_match.${matchType}Match = "perfect" and moving contract to full_match
  await serverFixture.sourcifyDatabase.query(
    `UPDATE sourcify_matches SET ${matchType}_match='perfect' WHERE 1=1`,
  );
  const existingPath = path.join(
    config.get("repositoryV1.path"),
    "contracts",
    "partial_match",
    chainFixture.chainId,
    chainFixture.defaultContractAddress,
  );
  const newPath = path.join(
    config.get("repositoryV1.path"),
    "contracts",
    "full_match",
    chainFixture.chainId,
    chainFixture.defaultContractAddress,
  );
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  await fs.rename(existingPath, newPath);

  // verify again with original metadata file
  res = await chai
    .request(serverFixture.server.app)
    .post("/")
    .field("address", chainFixture.defaultContractAddress)
    .field("chain", chainFixture.chainId)
    .field("creatorTxHash", chainFixture.defaultContractCreatorTx)
    .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
    .attach("files", chainFixture.defaultContractSource);
  await assertVerification(
    serverFixture,
    null,
    res,
    null,
    chainFixture.defaultContractAddress,
    chainFixture.chainId,
  );

  const contractMatchesWithPerfectMetadata =
    await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_match, creation_match FROM sourcify_matches;",
    );

  chai
    .expect(contractMatchesWithPerfectMetadata.rows[0].runtime_match)
    .to.equal("perfect");
  chai
    .expect(contractMatchesWithPerfectMetadata.rows[0].creation_match)
    .to.equal("perfect");

  const contractDeploymentWithCreatorTransactionHash =
    await serverFixture.sourcifyDatabase.query(
      "SELECT encode(transaction_hash, 'hex') as transaction_hash, block_number, transaction_index, contract_id FROM contract_deployments",
    );

  const contractIdWithCreatorTransactionHash =
    contractDeploymentWithCreatorTransactionHash?.rows[0].contract_id;

  // There should not be a new contract_id
  chai
    .expect(contractIdWithCreatorTransactionHash)
    .to.equal(contractIdWithoutCreatorTransactionHash);

  const sourcesResult = await serverFixture.sourcifyDatabase.query(
    "SELECT encode(source_hash, 'hex') as source_hash FROM compiled_contracts_sources",
  );

  chai.expect(sourcesResult?.rows).to.have.length(2);
  chai.expect(sourcesResult?.rows).to.deep.equal([
    {
      source_hash:
        "fd080cadfc692807b0d856c83148034ab5c47ededd67ea6c93c500a2a0fd4378",
    },
    {
      source_hash:
        "fb898a1d72892619d00d572bca59a5d98a9664169ff850e2389373e2421af4aa",
    },
  ]);
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
