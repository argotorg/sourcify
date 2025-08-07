import { BytesLike, ContractFactory, Interface, InterfaceAbi, JsonRpcSigner } from "ethers";
import chai from "chai";
import chaiHttp from "chai-http";
import { ServerFixture } from "./ServerFixture";
import sinon from "sinon";
import { Sequelize } from "sequelize";

chai.use(chaiHttp);

export const unusedAddress = "0xf1Df8172F308e0D47D0E5f9521a5210467408535";

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
