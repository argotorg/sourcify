import chai, { expect } from "chai";
import chaiHttp from "chai-http";
import { deployAndVerifyContract } from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import { getAddress } from "ethers";
import {
  SourcifyChain,
  SourcifyChainMap,
} from "@ethereum-sourcify/lib-sourcify";

chai.use(chaiHttp);

describe("GET /v2/contract/all-chains/:address", function () {
  const TEST_CHAIN_IDs = [11111, 22222, 33333];
  const TEST_CHAIN_PORTS = [8546, 8547, 8548];
  const chainFixtures = TEST_CHAIN_IDs.map(
    (chainId, index) =>
      new LocalChainFixture({
        chainId: chainId.toString(),
        port: TEST_CHAIN_PORTS[index],
      }),
  );
  const serverFixture = new ServerFixture({
    chains: TEST_CHAIN_IDs.reduce((acc, chainId, index) => {
      acc[chainId.toString()] = new SourcifyChain({
        name: `Test Chain ${chainId}`,
        title: `Test Chain ${chainId}`,
        supported: true,
        chainId: chainId,
        rpc: [`http://localhost:${TEST_CHAIN_PORTS[index]}`],
        rpcWithoutApiKeys: [`http://localhost:${TEST_CHAIN_PORTS[index]}`],
      });
      return acc;
    }, {} as SourcifyChainMap),
  });

  // Note: LocalChainFixture and ServerFixture have their own before/after hooks
  // built into their constructors, so no additional setup needed here

  it("should return a 404 and empty results when the contract is not found", async function () {
    const randomAddress =
      chainFixtures[0].defaultContractAddress.slice(0, -8) + "aaaaaaaa";
    const validAddress = getAddress(randomAddress.toLowerCase());

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/contract/all-chains/${validAddress}`);
    chai.expect(res.status).to.equal(404);
    chai.expect(res.body.results).to.be.an.instanceOf(Array);
    chai.expect(res.body.results.length).to.equal(0);
  });

  it("should return the deployed and verified contract on the same address on all chains", async function () {
    // Deploy the contract on all chains in parallel
    const addresses = await Promise.all(
      chainFixtures.map((chainFixture) =>
        deployAndVerifyContract(chainFixture, serverFixture, false),
      ),
    );
    expect(addresses.length).to.equal(TEST_CHAIN_IDs.length); // Make sure all are deployed

    // Check all addresses are the same
    const firstAddress = addresses[0];
    addresses.forEach((address) => {
      expect(address).to.equal(firstAddress);
    });

    // Check the contract is listed on all chains
    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/contract/all-chains/${addresses[0]}`);
    chai.expect(res.status).to.equal(200);

    chai
      .expect(res.body.results.length, "Not all chains are verified")
      .to.equal(TEST_CHAIN_IDs.length);
    TEST_CHAIN_IDs.forEach((chainId) => {
      const matchingResult = res.body.results.find(
        (result: any) => result.chainId === chainId.toString(),
      );

      chai.expect(matchingResult).to.include({
        match: "exact_match",
        creationMatch: "exact_match",
        runtimeMatch: "exact_match",
        address: addresses[0],
        chainId: chainId.toString(),
      });
    });
  });
});
