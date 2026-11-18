import chai from "chai";
import {
  BINARY_SEARCH_TIMEOUT_MS,
  HYPERSYNC_LOOKUP_TIMEOUT_MS,
  findContractCreationTxByBinarySearchWithTimeout,
  getCreatorTx,
} from "../../../src/server/services/utils/contract-creation-util";
import type { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify";
import sinon from "sinon";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { findContractCreationTxByBinarySearch } from "../../../src/server/services/utils/contract-creation-util";
import logger from "../../../src/common/logger";

// Tests hitting the live creation-tx APIs are in test/creation-tx-apis/.
describe("contract creation util", function () {
  let sourcifyChainsMap: SourcifyChainMap;

  // The dummy RPC satisfies SourcifyChain's "at least one RPC" requirement.
  before(async () => {
    const dummyRpcs = [{ rpc: "http://localhost/" }];
    sourcifyChainsMap = {
      "1": new SourcifyChain({
        name: "Ethereum Mainnet",
        chainId: 1,
        supported: true,
        rpcs: dummyRpcs,
        fetchContractCreationTxUsing: {
          etherscanApi: true,
          blockscoutApi: { url: "https://eth.blockscout.com/" },
          routescanApi: { type: "mainnet" },
        },
        etherscanApi: {
          supported: true,
          apiKeyEnvName: "ETHERSCAN_API_KEY_MAINNET",
        },
      }),
    };
  });

  describe("Etherscan API key handling for getCreatorTx", function () {
    const ADDRESS = "0x0000000000000000000000000000000000000001";
    const GLOBAL_KEY = "SECRET_GLOBAL_ETHERSCAN_KEY";
    let prevGlobalKey: string | undefined;
    let fetchStub: sinon.SinonStub;

    beforeEach(function () {
      prevGlobalKey = process.env.ETHERSCAN_API_KEY;
      process.env.ETHERSCAN_API_KEY = GLOBAL_KEY;
      fetchStub = sinon.stub(global, "fetch" as any).resolves({
        status: 200,
        json: async () => ({ result: [{ txHash: "0xabc" }] }),
      } as any);
    });

    afterEach(function () {
      fetchStub.restore();
      if (prevGlobalKey === undefined) delete process.env.ETHERSCAN_API_KEY;
      else process.env.ETHERSCAN_API_KEY = prevGlobalKey;
    });

    it("should NOT send the global ETHERSCAN_API_KEY to a custom Etherscan-compatible explorer (with url)", async function () {
      const chain = new SourcifyChain({
        name: "Custom Explorer Chain",
        chainId: 999999,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: { etherscanApi: true },
        etherscanApi: {
          supported: true,
          url: "https://block-explorer-api.testnet.battlechain.com",
        },
      });

      await getCreatorTx(chain, ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      const calledUrl = fetchStub.firstCall.args[0] as string;
      chai.expect(calledUrl).to.not.include(GLOBAL_KEY);
      chai.expect(calledUrl.endsWith("&apikey=")).to.equal(true);
    });

    it("should not log the API key when the API request fails", async function () {
      fetchStub.resolves({ status: 429, json: async () => ({}) } as any);
      const warnStub = sinon.stub(logger, "warn");
      const debugStub = sinon.stub(logger, "debug");
      const chain = new SourcifyChain({
        name: "Canonical Etherscan Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: { etherscanApi: true },
        etherscanApi: { supported: true },
      });

      try {
        await getCreatorTx(chain, ADDRESS);
      } finally {
        warnStub.restore();
        debugStub.restore();
      }

      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai.expect(fetchStub.firstCall.args[0]).to.include(GLOBAL_KEY);
      const loggedArgs = JSON.stringify([
        ...warnStub.getCalls().map((call) => call.args),
        ...debugStub.getCalls().map((call) => call.args),
      ]);
      chai.expect(loggedArgs).to.not.include(GLOBAL_KEY);
      const warnCall = warnStub
        .getCalls()
        .map((call) => call.args as any[])
        .find((args) => args[0] === "Error while getting creation transaction");
      chai.expect(warnCall).to.not.equal(undefined);
      chai
        .expect(warnCall?.[1]?.error)
        .to.equal(
          `Contract creator tx could not be fetched from https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getcontractcreation&contractaddresses=${ADDRESS}&apikey= because of status code 429`,
        );
    });

    it("should send the global ETHERSCAN_API_KEY to a canonical Etherscan chain (no url)", async function () {
      const chain = new SourcifyChain({
        name: "Canonical Etherscan Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: { etherscanApi: true },
        etherscanApi: { supported: true },
      });

      await getCreatorTx(chain, ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      const calledUrl = fetchStub.firstCall.args[0] as string;
      chai.expect(calledUrl).to.include(GLOBAL_KEY);
    });
  });

  describe("Blockscout PRO API handling for getCreatorTx", function () {
    const ADDRESS = "0x0000000000000000000000000000000000000001";
    const PRO_API_KEY = "SECRET_BLOCKSCOUT_PRO_KEY";
    const INSTANCE_URL = "https://eth.blockscout.com/";
    let prevProApiKey: string | undefined;
    let fetchStub: sinon.SinonStub;

    const createChain = (proApi?: boolean) =>
      new SourcifyChain({
        name: "Blockscout Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: {
          blockscoutApi: { url: INSTANCE_URL, proApi },
        },
      });

    beforeEach(function () {
      prevProApiKey = process.env.BLOCKSCOUT_PRO_API_KEY;
      process.env.BLOCKSCOUT_PRO_API_KEY = PRO_API_KEY;
      fetchStub = sinon.stub(global, "fetch" as any).resolves({
        status: 200,
        json: async () => ({ creation_transaction_hash: "0xabc" }),
      } as any);
    });

    afterEach(function () {
      fetchStub.restore();
      if (prevProApiKey === undefined)
        delete process.env.BLOCKSCOUT_PRO_API_KEY;
      else process.env.BLOCKSCOUT_PRO_API_KEY = prevProApiKey;
    });

    it("should use the PRO API gateway with the key when proApi is true", async function () {
      const creatorTx = await getCreatorTx(createChain(true), ADDRESS);

      chai.expect(creatorTx).to.equal("0xabc");
      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai
        .expect(fetchStub.firstCall.args[0])
        .to.equal(
          `https://api.blockscout.com/1/api/v2/addresses/${ADDRESS}?apikey=${PRO_API_KEY}`,
        );
    });

    it("should use the instance url when proApi is false", async function () {
      await getCreatorTx(createChain(false), ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      const calledUrl = fetchStub.firstCall.args[0] as string;
      chai
        .expect(calledUrl)
        .to.equal(`${INSTANCE_URL}/api/v2/addresses/${ADDRESS}`);
      chai.expect(calledUrl).to.not.include(PRO_API_KEY);
    });

    it("should use the instance url when proApi is not set", async function () {
      await getCreatorTx(createChain(), ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai
        .expect(fetchStub.firstCall.args[0])
        .to.equal(`${INSTANCE_URL}/api/v2/addresses/${ADDRESS}`);
    });

    it("should use the instance url when BLOCKSCOUT_PRO_API_KEY is not set", async function () {
      delete process.env.BLOCKSCOUT_PRO_API_KEY;

      await getCreatorTx(createChain(true), ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai
        .expect(fetchStub.firstCall.args[0])
        .to.equal(`${INSTANCE_URL}/api/v2/addresses/${ADDRESS}`);
    });
  });

  describe("HyperSync API handling for getCreatorTx", function () {
    const ADDRESS = "0x00000000219ab540356cBB839Cbe05303d7705Fa";
    const TOKEN = "SECRET_ENVIO_TOKEN";
    const URL = "https://1.hypersync.xyz";
    const TRACES_URL = "https://eth-traces.hypersync.xyz";
    const BLOCKSCOUT_URL = "https://eth.blockscout.com/";
    const BINARY_SEARCH_TX = "0xbinarysearch";
    let prevToken: string | undefined;
    let fetchStub: sinon.SinonStub;

    const createChain = (options?: {
      tracesUrl?: string;
      blockscout?: boolean;
      binarySearchHit?: boolean;
    }) => {
      const chain = new SourcifyChain({
        name: "HyperSync Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: {
          hyperSyncApi: { url: URL, tracesUrl: options?.tracesUrl },
          ...(options?.blockscout
            ? { blockscoutApi: { url: BLOCKSCOUT_URL } }
            : {}),
        },
      });
      // The binary search is the step after HyperSync.
      if (options?.binarySearchHit) {
        sinon.stub(chain, "getBlockNumber").resolves(0);
        sinon.stub(chain, "getBlock").resolves({
          number: 0,
          prefetchedTransactions: [{ to: null, hash: BINARY_SEARCH_TX }],
        } as any);
        sinon
          .stub(chain, "getTxReceipt")
          .resolves({ contractAddress: ADDRESS } as any);
      }
      return chain;
    };

    const hyperSyncResponse = (
      data: any[],
      nextBlock = 101,
      archiveHeight = 100,
    ) =>
      ({
        status: 200,
        json: async () => ({
          data,
          next_block: nextBlock,
          archive_height: archiveHeight,
        }),
      }) as any;

    const blockscoutResponse = {
      status: 200,
      json: async () => ({ creation_transaction_hash: "0xblockscout" }),
    } as any;

    const getBody = (call: sinon.SinonSpyCall) =>
      JSON.parse(call.args[1].body as string);

    // The lookup must not reach the binary search.
    const getCreatorTxWithoutBinarySearch = (chain: SourcifyChain) => {
      sinon.stub(chain, "getBlockNumber").rejects(new Error("Blocked"));
      return getCreatorTx(chain, ADDRESS);
    };

    beforeEach(function () {
      prevToken = process.env.ENVIO_API_TOKEN;
      process.env.ENVIO_API_TOKEN = TOKEN;
      fetchStub = sinon.stub(global, "fetch" as any);
    });

    afterEach(function () {
      fetchStub.restore();
      if (prevToken === undefined) delete process.env.ENVIO_API_TOKEN;
      else process.env.ENVIO_API_TOKEN = prevToken;
    });

    it("should find the creation tx of a direct deployment", async function () {
      fetchStub.resolves(
        hyperSyncResponse([
          { transactions: [{ hash: "0xabc", status: 1, block_number: 5 }] },
        ]),
      );

      const creatorTx = await getCreatorTx(createChain(), ADDRESS);

      chai.expect(creatorTx).to.equal("0xabc");
      chai.expect(fetchStub.calledOnce).to.equal(true);
      const [url, init] = fetchStub.firstCall.args;
      chai.expect(url).to.equal(`${URL}/query`);
      chai.expect(init.method).to.equal("POST");
      chai.expect(init.headers.Authorization).to.equal(`Bearer ${TOKEN}`);
      chai.expect(getBody(fetchStub.firstCall)).to.deep.equal({
        from_block: 0,
        transactions: [{ contract_address: [ADDRESS.toLowerCase()] }],
        field_selection: { transaction: ["hash", "status", "block_number"] },
        join_mode: "JoinNothing",
      });
    });

    it("should not run when another fetcher finds the creation tx", async function () {
      fetchStub.resolves(blockscoutResponse);

      const creatorTx = await getCreatorTx(
        createChain({ blockscout: true }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal("0xblockscout");
      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai
        .expect(fetchStub.firstCall.args[0])
        .to.equal(`${BLOCKSCOUT_URL}/api/v2/addresses/${ADDRESS}`);
    });

    it("should run after the other fetchers and before the binary search", async function () {
      fetchStub.onCall(0).resolves({ status: 200, json: async () => ({}) });
      fetchStub
        .onCall(1)
        .resolves(
          hyperSyncResponse([{ transactions: [{ hash: "0xabc", status: 1 }] }]),
        );
      const chain = createChain({ blockscout: true, binarySearchHit: true });

      const creatorTx = await getCreatorTx(chain, ADDRESS);

      chai.expect(creatorTx).to.equal("0xabc");
      chai
        .expect(fetchStub.getCalls().map((call) => call.args[0]))
        .to.deep.equal([
          `${BLOCKSCOUT_URL}/api/v2/addresses/${ADDRESS}`,
          `${URL}/query`,
        ]);
      chai
        .expect((chain.getBlockNumber as sinon.SinonStub).called)
        .to.equal(false);
    });

    it("should accept a creation tx without a status", async function () {
      fetchStub.resolves(
        hyperSyncResponse([
          { transactions: [{ hash: "0xabc", status: null }] },
        ]),
      );

      const creatorTx = await getCreatorTx(createChain(), ADDRESS);

      chai.expect(creatorTx).to.equal("0xabc");
    });

    it("should ignore a failed deployment tx", async function () {
      fetchStub.resolves(
        hyperSyncResponse([{ transactions: [{ hash: "0xabc", status: 0 }] }]),
      );

      const creatorTx = await getCreatorTxWithoutBinarySearch(createChain());

      chai.expect(creatorTx).to.equal(null);
      chai.expect(fetchStub.calledOnce).to.equal(true);
    });

    it("should request the next block range until the scan is complete", async function () {
      fetchStub.onCall(0).resolves(hyperSyncResponse([], 40, 100));
      fetchStub.onCall(1).resolves(hyperSyncResponse([], 80, 100));
      fetchStub
        .onCall(2)
        .resolves(
          hyperSyncResponse(
            [{ transactions: [{ hash: "0xabc", status: 1 }] }],
            101,
            100,
          ),
        );

      const creatorTx = await getCreatorTx(createChain(), ADDRESS);

      chai.expect(creatorTx).to.equal("0xabc");
      chai.expect(fetchStub.callCount).to.equal(3);
      chai
        .expect(fetchStub.getCalls().map((call) => getBody(call).from_block))
        .to.deep.equal([0, 40, 80]);
    });

    it("should remove trailing slashes from the urls", async function () {
      fetchStub.resolves(hyperSyncResponse([]));
      const chain = new SourcifyChain({
        name: "HyperSync Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: {
          hyperSyncApi: { url: `${URL}/`, tracesUrl: `${TRACES_URL}//` },
        },
      });

      await getCreatorTxWithoutBinarySearch(chain);

      chai
        .expect(fetchStub.getCalls().map((call) => call.args[0]))
        .to.deep.equal([`${URL}/query`, `${TRACES_URL}/query`]);
    });

    // An incomplete scan must not count as a miss without a warning.
    const unexpectedResponses: { name: string; body: any; error: string }[] = [
      {
        name: "does not advance",
        body: { data: [], next_block: 0, archive_height: 100 },
        error:
          "HyperSync API did not advance from block 0 on the transactions query",
      },
      {
        name: "has no archive_height",
        body: { data: [], next_block: 50, archive_height: null },
        error: "HyperSync API returned an unexpected response",
      },
      {
        name: "has no data array",
        body: { data: {}, next_block: 101, archive_height: 100 },
        error: "HyperSync API returned an unexpected response",
      },
      {
        name: "is empty",
        body: null,
        error: "HyperSync API returned an unexpected response",
      },
    ];
    for (const { name, body, error } of unexpectedResponses) {
      it(`should use the binary search when the response ${name}`, async function () {
        fetchStub
          .onCall(0)
          .resolves({ status: 200, json: async () => body } as any);
        const warnStub = sinon.stub(logger, "warn");

        let creatorTx: string | null;
        try {
          creatorTx = await getCreatorTx(
            createChain({ binarySearchHit: true }),
            ADDRESS,
          );
        } finally {
          warnStub.restore();
        }

        chai.expect(creatorTx).to.equal(BINARY_SEARCH_TX);
        chai.expect(fetchStub.callCount).to.equal(1);
        const warnCall = warnStub
          .getCalls()
          .map((call) => call.args as any[])
          .find(
            (args) => args[0] === "Error fetching creation tx from HyperSync",
          );
        chai.expect(warnCall?.[1]?.error).to.equal(error);
      });
    }

    it("should find the creation tx of a factory deployment in the traces", async function () {
      fetchStub.onCall(0).resolves(hyperSyncResponse([]));
      fetchStub.onCall(1).resolves(
        hyperSyncResponse([
          {
            traces: [
              {
                transaction_hash: "0xfactory",
                block_number: 7,
                transaction_position: 2,
                error: null,
              },
            ],
          },
        ]),
      );

      const creatorTx = await getCreatorTx(
        createChain({ tracesUrl: TRACES_URL }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal("0xfactory");
      chai.expect(fetchStub.callCount).to.equal(2);
      chai.expect(fetchStub.secondCall.args[0]).to.equal(`${TRACES_URL}/query`);
      chai
        .expect(fetchStub.secondCall.args[1].headers.Authorization)
        .to.equal(`Bearer ${TOKEN}`);
      chai.expect(getBody(fetchStub.secondCall)).to.deep.equal({
        from_block: 0,
        traces: [{ type: ["create"], address: [ADDRESS.toLowerCase()] }],
        field_selection: {
          trace: [
            "transaction_hash",
            "block_number",
            "transaction_position",
            "error",
          ],
        },
        join_mode: "JoinNothing",
      });
    });

    it("should not query the traces when the transaction query finds the creation tx", async function () {
      fetchStub.resolves(
        hyperSyncResponse([{ transactions: [{ hash: "0xabc", status: 1 }] }]),
      );

      const creatorTx = await getCreatorTx(
        createChain({ tracesUrl: TRACES_URL }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal("0xabc");
      chai.expect(fetchStub.calledOnce).to.equal(true);
    });

    it("should use the last create trace without an error", async function () {
      fetchStub.onCall(0).resolves(hyperSyncResponse([]));
      fetchStub.onCall(1).resolves(
        hyperSyncResponse(
          [
            {
              traces: [
                {
                  transaction_hash: "0xfirst",
                  block_number: 7,
                  transaction_position: 0,
                },
                {
                  transaction_hash: "0xfailed",
                  block_number: 8,
                  transaction_position: 0,
                  error: "Reverted",
                },
              ],
            },
          ],
          50,
          100,
        ),
      );
      fetchStub.onCall(2).resolves(
        hyperSyncResponse([
          {
            traces: [
              {
                transaction_hash: "0xlast",
                block_number: 60,
                transaction_position: 4,
              },
              {
                transaction_hash: "0xcollision",
                block_number: 70,
                transaction_position: 1,
                error: "contract address collision",
              },
            ],
          },
        ]),
      );

      const creatorTx = await getCreatorTx(
        createChain({ tracesUrl: TRACES_URL }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal("0xlast");
      chai.expect(fetchStub.callCount).to.equal(3);
      chai.expect(getBody(fetchStub.thirdCall).from_block).to.equal(50);
    });

    it("should use the block and the tx position to find the last create trace", async function () {
      fetchStub.onCall(0).resolves(hyperSyncResponse([]));
      fetchStub.onCall(1).resolves(
        hyperSyncResponse([
          {
            traces: [
              {
                transaction_hash: "0xsameBlockLater",
                block_number: 60,
                transaction_position: 9,
              },
              {
                transaction_hash: "0xsameBlockEarlier",
                block_number: 60,
                transaction_position: 4,
              },
              {
                transaction_hash: "0xearlierBlock",
                block_number: 7,
                transaction_position: 20,
              },
            ],
          },
        ]),
      );

      const creatorTx = await getCreatorTx(
        createChain({ tracesUrl: TRACES_URL }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal("0xsameBlockLater");
    });

    it("should use the binary search when the trace query fails", async function () {
      fetchStub.onCall(0).resolves(hyperSyncResponse([]));
      fetchStub
        .onCall(1)
        .resolves({ status: 403, json: async () => ({}) } as any);

      const creatorTx = await getCreatorTx(
        createChain({ tracesUrl: TRACES_URL, binarySearchHit: true }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal(BINARY_SEARCH_TX);
      chai.expect(fetchStub.callCount).to.equal(2);
      chai.expect(fetchStub.secondCall.args[0]).to.equal(`${TRACES_URL}/query`);
    });

    it("should use one lookup timeout for the transaction query and the trace query", async function () {
      const clock = sinon.useFakeTimers({ toFake: ["Date"] });
      // Each request takes 20 seconds. The transaction query needs one request.
      fetchStub.callsFake(async (url: string) => {
        if (url === `${URL}/query`) {
          clock.tick(20 * 1000);
          return hyperSyncResponse([]);
        }
        clock.tick(20 * 1000);
        return hyperSyncResponse([], 50, 100);
      });

      try {
        const creatorTx = await getCreatorTx(
          createChain({ tracesUrl: TRACES_URL, binarySearchHit: true }),
          ADDRESS,
        );
        chai.expect(creatorTx).to.equal(BINARY_SEARCH_TX);
      } finally {
        clock.restore();
      }

      // The second trace request does not start, because the 30 seconds are over.
      chai
        .expect(fetchStub.getCalls().map((call) => call.args[0]))
        .to.deep.equal([`${URL}/query`, `${TRACES_URL}/query`]);
    });

    it("should return null when all create traces have an error", async function () {
      fetchStub.onCall(0).resolves(hyperSyncResponse([]));
      fetchStub.onCall(1).resolves(
        hyperSyncResponse([
          {
            traces: [
              {
                transaction_hash: "0xfailed",
                block_number: 8,
                transaction_position: 0,
                error: "Out of gas",
              },
            ],
          },
        ]),
      );

      const creatorTx = await getCreatorTxWithoutBinarySearch(
        createChain({ tracesUrl: TRACES_URL }),
      );

      chai.expect(creatorTx).to.equal(null);
    });

    it("should not query the traces without a tracesUrl", async function () {
      fetchStub.resolves(hyperSyncResponse([]));

      const creatorTx = await getCreatorTxWithoutBinarySearch(createChain());

      chai.expect(creatorTx).to.equal(null);
      chai.expect(fetchStub.calledOnce).to.equal(true);
    });

    for (const status of [401, 403, 429]) {
      it(`should use the binary search when HyperSync returns status ${status}`, async function () {
        fetchStub.resolves({ status, json: async () => ({}) } as any);

        const creatorTx = await getCreatorTx(
          createChain({ tracesUrl: TRACES_URL, binarySearchHit: true }),
          ADDRESS,
        );

        chai.expect(creatorTx).to.equal(BINARY_SEARCH_TX);
        chai.expect(fetchStub.calledOnce).to.equal(true);
      });
    }

    it("should use the binary search when the HyperSync request times out", async function () {
      const timeoutError = new Error(
        "The operation was aborted due to timeout",
      );
      timeoutError.name = "TimeoutError";
      fetchStub.rejects(timeoutError);

      const creatorTx = await getCreatorTx(
        createChain({ binarySearchHit: true }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal(BINARY_SEARCH_TX);
      chai
        .expect(fetchStub.firstCall.args[1].signal)
        .to.be.instanceOf(AbortSignal);
    });

    it("should stop the lookup after HYPERSYNC_LOOKUP_TIMEOUT_MS", async function () {
      const clock = sinon.useFakeTimers({ toFake: ["Date"] });
      let nextBlock = 0;
      // Each request takes 10 seconds and does not reach the chain head.
      fetchStub.callsFake(async () => {
        clock.tick(10 * 1000);
        nextBlock += 10;
        return hyperSyncResponse([], nextBlock, 1000);
      });

      try {
        const creatorTx = await getCreatorTx(
          createChain({ binarySearchHit: true }),
          ADDRESS,
        );
        chai.expect(creatorTx).to.equal(BINARY_SEARCH_TX);
      } finally {
        clock.restore();
      }

      // Three requests of 10 seconds reach the limit of 30 seconds.
      chai.expect(HYPERSYNC_LOOKUP_TIMEOUT_MS).to.equal(30 * 1000);
      chai.expect(fetchStub.callCount).to.equal(3);
    });

    it("should skip HyperSync when ENVIO_API_TOKEN is not set", async function () {
      delete process.env.ENVIO_API_TOKEN;

      const creatorTx = await getCreatorTx(
        createChain({ tracesUrl: TRACES_URL, binarySearchHit: true }),
        ADDRESS,
      );

      chai.expect(creatorTx).to.equal(BINARY_SEARCH_TX);
      chai.expect(fetchStub.called).to.equal(false);
    });

    it("should not log the token", async function () {
      const warnStub = sinon.stub(logger, "warn");
      const debugStub = sinon.stub(logger, "debug");
      const infoStub = sinon.stub(logger, "info");
      let loggedArgs: string;
      try {
        // A successful lookup
        fetchStub.resolves(
          hyperSyncResponse([{ transactions: [{ hash: "0xabc", status: 1 }] }]),
        );
        await getCreatorTx(createChain({ tracesUrl: TRACES_URL }), ADDRESS);
        // A failed lookup
        fetchStub.resolves({ status: 429, json: async () => ({}) } as any);
        await getCreatorTxWithoutBinarySearch(
          createChain({ tracesUrl: TRACES_URL }),
        );
        loggedArgs = JSON.stringify(
          [warnStub, debugStub, infoStub].flatMap((stub) =>
            stub.getCalls().map((call) => call.args),
          ),
        );
        const warnCall = warnStub
          .getCalls()
          .map((call) => call.args as any[])
          .find(
            (args) => args[0] === "Error fetching creation tx from HyperSync",
          );
        chai
          .expect(warnCall?.[1]?.error)
          .to.equal("HyperSync API returned status 429");
      } finally {
        warnStub.restore();
        debugStub.restore();
        infoStub.restore();
      }

      chai.expect(loggedArgs).to.not.include(TOKEN);
    });

    it("should not log the token when the fetch error contains it", async function () {
      // fetch rejects an invalid header value and puts the value into the error message.
      fetchStub.restore();
      process.env.ENVIO_API_TOKEN = `${TOKEN}\nSECOND_LINE`;
      const warnStub = sinon.stub(logger, "warn");
      const debugStub = sinon.stub(logger, "debug");
      let loggedArgs: string;
      try {
        await getCreatorTxWithoutBinarySearch(createChain());
        loggedArgs = JSON.stringify(
          [warnStub, debugStub].flatMap((stub) =>
            stub.getCalls().map((call) => call.args),
          ),
        );
      } finally {
        warnStub.restore();
        debugStub.restore();
        // afterEach restores the stub.
        fetchStub = sinon.stub(global, "fetch" as any);
      }

      chai
        .expect(loggedArgs)
        .to.include("Error fetching creation tx from HyperSync");
      chai.expect(loggedArgs).to.include("****");
      chai.expect(loggedArgs).to.not.include(TOKEN);
      chai.expect(loggedArgs).to.not.include("SECOND_LINE");
    });
  });

  describe("findContractCreationTxByBinarySearch", function () {
    let mockSourcifyChain: SourcifyChain;
    const sandbox = sinon.createSandbox();

    beforeEach(() => {
      // Create a mock SourcifyChain instance
      mockSourcifyChain = {
        getBlockNumber: sinon.stub(),
        getBytecode: sinon.stub(),
        getBlock: sinon.stub(),
        getTxReceipt: sinon.stub(),
        chainId: 1,
      } as any;
    });

    afterEach(() => {
      sandbox.restore();
    });

    // Not a unit test — fetches from a live mainnet archive RPC. Skipped
    // because the test chain map is stubbed (mainnet uses http://localhost/),
    // so binary search has no real RPC to query. Re-enable locally when
    // debugging against a real RPC by replacing the mainnet stub's rpcs
    // entry with a working archive endpoint.
    it.skip("should find contract creation transaction using binary search for a live chain", async function () {
      // Don't run if it's an external PR. RPCs need API keys that can't be exposed to external PRs.
      if (process.env.CIRCLE_PR_REPONAME !== undefined) {
        console.log("Skipping binary search test for external PR");
        return;
      }

      // Create a copy of the mainnet chain
      const mainnetChain = Object.create(
        Object.getPrototypeOf(sourcifyChainsMap["1"]),
        Object.getOwnPropertyDescriptors(sourcifyChainsMap["1"]),
      );
      // remove all creation tx fetching methods
      mainnetChain.fetchContractCreationTxUsing = undefined;

      const sourcifyChain = new SourcifyChain(mainnetChain);

      const creatorTx = await findContractCreationTxByBinarySearch(
        sourcifyChain,
        "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Tether contract
      );

      chai
        .expect(creatorTx)
        .to.equal(
          "0x2f1c5c2b44f771e942a8506148e256f94f1a464babc938ae0690c6e34cd79190",
        );
    });

    it("should find contract creation transaction using binary search", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";
      const creationTxHash =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

      const LATEST_BLOCK = 288031060;
      const CONTRACT_BLOCK = 4341321;

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(
        LATEST_BLOCK,
      );

      // Mock getBytecode to simulate contract deployment at block 500
      (mockSourcifyChain.getBytecode as sinon.SinonStub).callsFake(
        async (address, blockNumber) => {
          return blockNumber >= CONTRACT_BLOCK ? "0x1234" : "0x";
        },
      );

      // Mock block data
      const mockBlock = {
        prefetchedTransactions: [
          { hash: "0xother1", to: "0xsomeaddress" },
          { hash: "0xother2", to: "0xsomeaddress" },
          { hash: creationTxHash, to: null },
          { hash: "0xother3", to: "0xsomeaddress" },
        ],
        number: CONTRACT_BLOCK,
      };
      (mockSourcifyChain.getBlock as sinon.SinonStub).resolves(mockBlock);

      // Mock transaction receipt
      (mockSourcifyChain.getTxReceipt as sinon.SinonStub).resolves({
        contractAddress: contractAddress,
      });

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      // Verify the result
      chai.expect(result).to.equal(creationTxHash);

      // Verify binary search was performed correctly
      const bytecodeCalls = (
        mockSourcifyChain.getBytecode as sinon.SinonStub
      ).getCalls();
      chai.expect(bytecodeCalls.length).to.be.greaterThan(1); // Should make multiple calls during binary search

      // Verify the block at deployment was checked
      chai.expect(
        (mockSourcifyChain.getBlock as sinon.SinonStub).calledWith(
          CONTRACT_BLOCK,
          true,
        ),
      ).to.be.true;
    });

    it("should return null if contract creation transaction is not found", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(1000);
      (mockSourcifyChain.getBytecode as sinon.SinonStub).resolves("0x1234");

      // Mock block with no matching creation transaction
      const mockBlock = {
        prefetchedTransactions: [
          { hash: "0xtx1", to: "0xsomeaddress" },
          { hash: "0xtx2", to: "0xsomeaddress" },
        ],
        number: 500,
      };
      (mockSourcifyChain.getBlock as sinon.SinonStub).resolves(mockBlock);
      (mockSourcifyChain.getTxReceipt as sinon.SinonStub).resolves({
        contractAddress: "0xdifferentaddress",
      });

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should handle errors gracefully", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses to throw error
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).rejects(
        new Error("Network error"),
      );

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should handle case where contract does not exist in any block", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(1000);
      // Contract never exists in any block
      (mockSourcifyChain.getBytecode as sinon.SinonStub).resolves("0x");

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should handle case where block has no transactions", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(1000);
      (mockSourcifyChain.getBytecode as sinon.SinonStub).resolves("0x1234");

      // Mock empty block
      const mockBlock = {
        prefetchedTransactions: [],
        number: 500,
      };
      (mockSourcifyChain.getBlock as sinon.SinonStub).resolves(mockBlock);

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should timeout when binary search takes too long", async function () {
      const clock = sandbox.useFakeTimers();
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // This will never resolve, forcing the timeout to trigger
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).returns(
        new Promise(() => {}),
      );

      const resultPromise = findContractCreationTxByBinarySearchWithTimeout(
        mockSourcifyChain,
        contractAddress,
      );

      await clock.tickAsync(BINARY_SEARCH_TIMEOUT_MS);

      const result = await resultPromise;
      chai.expect(result).to.be.null;
    });
  });
});
