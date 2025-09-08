import {
  BytesLike,
  ContractFactory,
  Interface,
  InterfaceAbi,
  JsonRpcSigner,
} from "ethers";
import chai from "chai";
import chaiHttp from "chai-http";
import { ServerFixture } from "./ServerFixture";
import sinon from "sinon";
import { Sequelize } from "sequelize";
import { LocalChainFixture } from "./LocalChainFixture";
import express from "express";
import { promises as fs } from "fs";
import path from "path";

chai.use(chaiHttp);

export const unusedAddress = "0xf1Df8172F308e0D47D0E5f9521a5210467408535";

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

/*export async function verifyContract(
  serverFixture: ServerFixture,
  chainFixture: LocalChainFixture,
  contractAddress?: string,
  creatorTxHash?: string,
  partial: boolean = false,
) {
  await chai
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
}*/

export async function verifyContract(
  serverFixture: ServerFixture,
  chainFixture: LocalChainFixture,
  contractAddress?: string,
  creatorTxHash?: string,
) {
  const verifyResponse = await chai
    .request(serverFixture.server.app)
    .post(
      `/verify/${chainFixture.chainId}/${contractAddress || chainFixture.defaultContractAddress}`,
    )
    .send({
      stdJsonInput: chainFixture.defaultContractJsonInput,
      compilerVersion:
        chainFixture.defaultContractMetadataObject.compiler.version,
      contractIdentifier: Object.entries(
        chainFixture.defaultContractMetadataObject.settings.compilationTarget,
      )[0].join(":"),
      creationTransactionHash:
        creatorTxHash || chainFixture.defaultContractCreatorTx,
    });

  chai
    .expect(verifyResponse.status)
    .to.equal(202, "Response body: " + JSON.stringify(verifyResponse.body));
  chai.expect(verifyResponse.body).to.have.property("verificationId");
  chai
    .expect(verifyResponse.body.verificationId)
    .to.match(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    );

  await completeVerification(
    serverFixture.server.app,
    verifyResponse.body.verificationId,
  );
}

export async function completeVerification(
  app: express.Application,
  verificationId: string,
  interval: number = 3,
  retries: number = 10,
) {
  while (retries-- > 0) {
    const resp = await chai.request(app).get(`/verify/${verificationId}`);

    if (resp?.body?.isJobCompleted) {
      break;
    }

    await waitSecs(interval);
  }
}

export async function deployAndVerifyContract(
  chainFixture: LocalChainFixture,
  serverFixture: ServerFixture,
) {
  const { contractAddress, txHash } =
    await deployFromAbiAndBytecodeForCreatorTxHash(
      chainFixture.localSigner,
      chainFixture.defaultContractArtifact.abi,
      chainFixture.defaultContractArtifact.bytecode,
      [],
    );
  await verifyContract(serverFixture, chainFixture, contractAddress, txHash);
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

export async function resetDatabase(database: Sequelize) {
  if (!database) {
    chai.assert.fail("Database pool not configured");
  }

  await database.query("DELETE FROM verification_jobs;");
  await database.query("DELETE FROM verification_jobs_ephemeral;");
  await database.query("DELETE FROM sourcify_matches;");
  await database.query("DELETE FROM verified_contracts;");
  await database.query("DELETE FROM contract_deployments;");
  await database.query("DELETE FROM compiled_contracts_sources;");
  await database.query("DELETE FROM sources;");
  await database.query("DELETE FROM compiled_contracts;");
  await database.query("DELETE FROM contracts;");
  await database.query("DELETE FROM code;");

  await database.query("ALTER TABLE sourcify_matches AUTO_INCREMENT = 1;");
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
