import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import { getAddress } from "ethers";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import type { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify";
import { ServerFixture } from "../../../helpers/ServerFixture";
import { MockRpcServer } from "../../../helpers/MockRpcServer";
import { hookIntoVerificationWorkerRun } from "../../../helpers/helpers";
import zkStdJsonInput from "../../../testcontracts/zksync/DealersMulticall/input.json";
import rpcResponses from "../../../testcontracts/zksync/DealersMulticall/rpc-responses.json";

chai.use(chaiHttp);

// A full end-to-end EraVM (zksolc) verification against a mocked Abstract chain.
// The verification runs through the real worker (real zksolc + era-solc
// compilation); the on-chain side is a local JSON-RPC server replaying captured
// Abstract mainnet responses, so no live RPC is needed at test time. The
// contract is DealersMulticall on Abstract (chainId 2741): CBOR metadata,
// constructor arguments, perfect runtime + perfect creation match.
describe("POST /v2/verify [zksolc/EraVM e2e]", function () {
  // Real compilation may download the zksolc/era-solc binaries on first run.
  this.timeout(600000);

  const CHAIN_ID = "2741";
  const ADDRESS = getAddress("0x39249c625d7a6c952a5ac389510839eb1bb33099");
  const CREATION_TX =
    "0xbd3c06a16832fe68cf04de2414774ef677d032680936f8ced0f16a46665bdaf3";
  const COMPILER_VERSION = "zksolc:1.5.15;solc:0.8.28-1.0.1";
  const CONTRACT_IDENTIFIER = "src/core/DealersMulticall.sol:DealersMulticall";
  const CONSTRUCTOR_ARGS =
    "0x0000000000000000000000000d8d2755a49d30bd57f6a9ba5fa8a7c9fff86e8e00000000000000000000000061ee140e5757366ece5ee89ea9688c0ea2da88e600000000000000000000000049090a745ba1e45c9c0f9c21448ce965b3798949000000000000000000000000e7598e61738921967f888736a1977b80da526510000000000000000000000000b89125a33eb5fd401a9ef66dece2a6a060989ccc";
  const DEPLOYER = getAddress("0xaceb129b6b2928de29fd21b09d508cec03d64ffa");

  const chains: SourcifyChainMap = {};
  const mockRpc = new MockRpcServer(
    rpcResponses as Record<string, unknown>,
    2741,
  );

  before(async () => {
    // Start the mock RPC and register the (mocked) Abstract chain BEFORE
    // ServerFixture's own `before` builds the server/worker pool from `chains`.
    await mockRpc.start();
    chains[CHAIN_ID] = new SourcifyChain({
      name: "Abstract (mock)",
      shortName: "abstract-mock",
      chainId: 2741,
      faucets: [],
      infoURL: "",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      network: "mainnet",
      networkId: 2741,
      rpcs: [
        {
          rpc: mockRpc.url,
          urlWithoutApiKey: mockRpc.url,
          maskedUrl: mockRpc.url,
        },
      ],
      supported: true,
    });
  });

  const serverFixture = new ServerFixture({ chains });
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(() => {
    sandbox.restore();
  });

  after(async () => {
    await mockRpc.stop();
  });

  it("verifies an EraVM contract through the worker and returns full contract details", async function () {
    if (!serverFixture.server.services.verification.isZkSolcEnabled) {
      // zksolc compiler repos not configured in this environment
      this.skip();
    }

    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${CHAIN_ID}/${ADDRESS}`)
      .send({
        stdJsonInput: zkStdJsonInput,
        compilerVersion: COMPILER_VERSION,
        contractIdentifier: CONTRACT_IDENTIFIER,
        creationTransactionHash: CREATION_TX,
      });

    chai
      .expect(verifyRes.status)
      .to.equal(202, "Response body: " + JSON.stringify(verifyRes.body));
    chai.expect(verifyRes.body).to.have.property("verificationId");

    await resolveWorkers();

    // Job completed successfully with an exact match
    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${verifyRes.body.verificationId}`);
    chai.expect(jobRes.status).to.equal(200);
    chai
      .expect(jobRes.body.error, JSON.stringify(jobRes.body.error))
      .to.equal(undefined);
    chai.expect(jobRes.body.isJobCompleted).to.equal(true);
    chai.expect(jobRes.body.contract).to.include({
      match: "exact_match",
      creationMatch: "exact_match",
      runtimeMatch: "exact_match",
      chainId: CHAIN_ID,
      address: ADDRESS,
    });

    // Full contract details from the lookup API
    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${CHAIN_ID}/${ADDRESS}?fields=creationBytecode,runtimeBytecode,deployment,compilation,abi`,
      );

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.include({
      match: "exact_match",
      creationMatch: "exact_match",
      runtimeMatch: "exact_match",
      chainId: CHAIN_ID,
      address: ADDRESS,
      matchId: "1",
    });
    chai.expect(res.body).to.have.property("verifiedAt");

    // Compilation identity — the combined zksolc toolchain version
    chai.expect(res.body.compilation).to.include({
      language: "Solidity",
      compiler: "zksolc",
      compilerVersion: COMPILER_VERSION,
      name: "DealersMulticall",
      fullyQualifiedName: CONTRACT_IDENTIFIER,
    });

    // Perfect runtime match: recompiled == on-chain, no transformations
    chai
      .expect(res.body.runtimeBytecode.onchainBytecode)
      .to.equal(res.body.runtimeBytecode.recompiledBytecode);
    chai.expect(res.body.runtimeBytecode.transformations).to.deep.equal([]);
    chai
      .expect(res.body.runtimeBytecode.transformationValues)
      .to.deep.equal({});
    // EraVM metadata is CBOR (>= 1.5.13), so cborAuxdata is present
    chai.expect(res.body.runtimeBytecode.cborAuxdata).to.not.equal(null);

    // On EraVM the creation "bytecode" is the ContractDeployer calldata, and the
    // constructor arguments are extracted as a creation transformation.
    chai
      .expect(res.body.creationBytecode.onchainBytecode)
      .to.equal(rpcResponses.eth_getTransactionByHash.input);
    chai
      .expect(
        res.body.creationBytecode.transformationValues.constructorArguments,
      )
      .to.equal(CONSTRUCTOR_ARGS);
    const constructorTransformation =
      res.body.creationBytecode.transformations.find(
        (t: { reason?: string }) => t.reason === "constructorArguments",
      );
    chai.expect(constructorTransformation, "constructor args transformation").to
      .exist;

    // Deployment info derived from the (mocked) creation tx + receipt
    chai.expect(res.body.deployment).to.include({
      transactionHash: CREATION_TX,
      deployer: DEPLOYER,
      blockNumber: "70803586",
      transactionIndex: "1",
    });

    // The stored bytecode is tagged as EraVM in the database
    const codeResult = await serverFixture.sourcifyDatabase.query(
      "SELECT DISTINCT vm FROM code WHERE code IS NOT NULL",
    );
    chai
      .expect(codeResult.rows.map((row: { vm: string }) => row.vm))
      .to.deep.equal(["eravm"]);
  });
});
