import type { JsonRpcSigner, JsonFragment, BytesLike } from "ethers";
import { ContractFactory, Contract } from "ethers";
import chai, { expect } from "chai";
import chaiHttp from "chai-http";
import path from "path";
import { promises as fs } from "fs";
import type { ServerFixture } from "./ServerFixture";
import type { LocalChainFixture } from "./LocalChainFixture";
import type { Pool } from "pg";
import sinon from "sinon";

chai.use(chaiHttp);

export const invalidAddress = "0x000000bCB92160f8B7E094998Af6BCaD7fa537ff"; // checksum false
export const unusedAddress = "0xf1Df8172F308e0D47D0E5f9521a5210467408535";

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

// Fetches a finished verification job and fails if it isn't complete.
async function getFinishedJob(
  serverFixture: ServerFixture,
  verificationId: string,
) {
  const jobRes = await chai
    .request(serverFixture.server.app)
    .get(`/v2/verify/${verificationId}`);

  if (!jobRes.body?.isJobCompleted) {
    throw new Error(
      `Verification job ${verificationId} did not complete: ${JSON.stringify(
        jobRes.body,
      )}`,
    );
  }
  return jobRes.body;
}

// Seeds a verified contract via the API v2 metadata verification endpoint and
// waits for the async job to finish. Kept as a shared helper for tests that just
// need an already-verified contract in the database.
export async function verifyContract(
  serverFixture: ServerFixture,
  resolveWorkers: () => Promise<void>,
  chainFixture: LocalChainFixture,
  contractAddress?: string,
  creatorTxHash?: string,
  partial: boolean = false,
) {
  const address = contractAddress || chainFixture.defaultContractAddress;
  const metadata = partial
    ? JSON.parse(chainFixture.defaultContractModifiedMetadata.toString())
    : chainFixture.defaultContractMetadataObject;
  const source = partial
    ? chainFixture.defaultContractModifiedSource
    : chainFixture.defaultContractSource;
  const sourcePath = Object.keys(metadata.sources)[0];

  const verifyRes = await chai
    .request(serverFixture.server.app)
    .post(`/v2/verify/metadata/${chainFixture.chainId}/${address}`)
    .send({
      sources: {
        [sourcePath]: source.toString(),
      },
      metadata,
      creationTransactionHash:
        creatorTxHash || chainFixture.defaultContractCreatorTx,
    });

  expect(
    verifyRes.status,
    `Verification request failed for ${address} on chain ${chainFixture.chainId}: ${JSON.stringify(
      verifyRes.body,
    )}`,
  ).to.equal(202);
  const { verificationId } = verifyRes.body;
  expect(verificationId, "No verificationId returned").to.be.a("string");

  await resolveWorkers();
  const job = await getFinishedJob(serverFixture, verificationId);
  expect(
    job.error,
    `Verification job errored for ${address}: ${JSON.stringify(job.error)}`,
  ).to.equal(undefined);
  expect(job.contract?.match).to.equal(partial ? "match" : "exact_match");
  return verifyRes;
}

// Seeds a Vyper contract via the API v2 standard-JSON verification endpoint and
// waits for the job to finish. Returns the final job body.
export async function verifyVyperV2(
  serverFixture: ServerFixture,
  resolveWorkers: () => Promise<void>,
  chainFixture: LocalChainFixture,
  contractAddress: string,
  txHash: string,
  vyperSource: string,
  compilerVersion: string,
  compilerSettings: Record<string, unknown>,
  sourceFileName: string = "test.vy",
  contractName: string = "test",
) {
  const verifyRes = await chai
    .request(serverFixture.server.app)
    .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
    .send({
      stdJsonInput: {
        language: "Vyper",
        sources: { [sourceFileName]: { content: vyperSource } },
        settings: compilerSettings,
      },
      compilerVersion,
      contractIdentifier: `${sourceFileName}:${contractName}`,
      creationTransactionHash: txHash,
    });
  expect(
    verifyRes.status,
    `Vyper verification request failed: ${JSON.stringify(verifyRes.body)}`,
  ).to.equal(202);
  await resolveWorkers();
  const job = await getFinishedJob(
    serverFixture,
    verifyRes.body.verificationId,
  );
  expect(
    job.error,
    `Vyper verification job errored: ${JSON.stringify(job.error)}`,
  ).to.equal(undefined);
  expect(job.contract?.match).to.equal("match");
  return job;
}

export async function deployAndVerifyContract(
  chainFixture: LocalChainFixture,
  serverFixture: ServerFixture,
  resolveWorkers: () => Promise<void>,
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
    resolveWorkers,
    chainFixture,
    contractAddress,
    txHash,
    partial,
  );
  return contractAddress;
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
