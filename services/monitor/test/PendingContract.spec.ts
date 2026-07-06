import { expect } from "chai";
import nock from "nock";
import type { Metadata } from "@ethereum-sourcify/lib-sourcify";
import PendingContract from "../src/PendingContract";
import { FileHash } from "../src/util";

const SERVER_URL = "http://localhost:5555/";
const SERVER_ORIGIN = "http://localhost:5555";
const CHAIN_ID = 1;
const ADDRESS = "0x1234567890123456789012345678901234567890";
const CREATION_TX_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const verifyPath = `/v2/verify/metadata/${CHAIN_ID}/${ADDRESS}`;

const metadata = {
  language: "Solidity",
  compiler: { version: "0.8.19+commit.7dd6d404" },
} as unknown as Metadata;

function buildPendingContract(): PendingContract {
  const pendingContract = new PendingContract(
    new FileHash("ipfs", "QmTest"),
    ADDRESS,
    CHAIN_ID,
    {},
  );
  pendingContract.metadata = metadata;
  pendingContract.fetchedSources = {
    "contracts/Storage.sol": {
      keccak256:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      content: "// SPDX-License-Identifier: MIT\ncontract Storage {}",
    },
  };
  return pendingContract;
}

describe("PendingContract.sendToSourcifyServer", function () {
  afterEach(() => {
    nock.cleanAll();
  });

  it("submits to the v2 metadata endpoint and returns the verification job", async () => {
    const pendingContract = buildPendingContract();
    let capturedBody: any;
    const scope = nock(SERVER_ORIGIN)
      .post(verifyPath, (body) => {
        capturedBody = body;
        return true;
      })
      .reply(202, { verificationId: "job-1" });

    const result = await pendingContract.sendToSourcifyServer(
      SERVER_URL,
      CREATION_TX_HASH,
    );

    expect(scope.isDone()).to.equal(true);
    expect(result).to.deep.equal({ verificationId: "job-1" });
    expect(capturedBody.sources).to.have.property("contracts/Storage.sol");
    expect(capturedBody.metadata).to.deep.equal(metadata);
    expect(capturedBody.creationTransactionHash).to.equal(CREATION_TX_HASH);
  });

  it("treats a 409 (already verified) as terminal and resolves without throwing", async () => {
    const pendingContract = buildPendingContract();
    const scope = nock(SERVER_ORIGIN)
      .post(verifyPath)
      .reply(409, { customCode: "already_verified" });

    const result = await pendingContract.sendToSourcifyServer(
      SERVER_URL,
      CREATION_TX_HASH,
    );

    expect(scope.isDone()).to.equal(true);
    expect(result).to.equal(undefined);
  });

  it("throws with the status and body when the server returns a non-ok status", async () => {
    const pendingContract = buildPendingContract();
    nock(SERVER_ORIGIN).post(verifyPath).reply(500);

    let error: any;
    try {
      await pendingContract.sendToSourcifyServer(SERVER_URL, CREATION_TX_HASH);
    } catch (e) {
      error = e;
    }

    expect(error).to.be.an("error");
  });

  it("throws if a fetched source has no content", async () => {
    const pendingContract = buildPendingContract();
    pendingContract.fetchedSources = {
      "contracts/Storage.sol": {
        keccak256:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    };

    let error: any;
    try {
      await pendingContract.sendToSourcifyServer(SERVER_URL, CREATION_TX_HASH);
    } catch (e) {
      error = e;
    }

    expect(error).to.be.an("error");
    expect(error.message).to.include("Unexpectedly empty source content");
  });
});
