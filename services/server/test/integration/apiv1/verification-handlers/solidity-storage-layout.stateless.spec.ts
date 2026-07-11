import chai from "chai";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";
import {
  SourcifyChain,
  type ISolidityCompiler,
  type SourcifyChainMap,
} from "@ethereum-sourcify/lib-sourcify";
import type { SolidityJsonInput } from "@ethereum-sourcify/compilers-types";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import { deployFromAbiAndBytecodeForCreatorTxHash } from "../../../helpers/helpers";
import { assertVerification } from "../../../helpers/assertions";

chai.use(chaiHttp);

describe("/private/replace-solidity-storage-layout", function () {
  const chainId = 31339;
  const port = 8555;
  const chainFixture = new LocalChainFixture({
    chainId: chainId.toString(),
    port,
  });
  const serverFixture = new ServerFixture({
    chains: {
      [chainId]: new SourcifyChain({
        name: "Historical storage layout test chain",
        chainId,
        supported: true,
        rpcs: [
          {
            rpc: `http://localhost:${port}`,
            urlWithoutApiKey: `http://localhost:${port}`,
          },
        ],
      }),
    } as SourcifyChainMap,
  });

  it("should backfill and expose a historical Solidity storage layout", async () => {
    const compilerVersion = "0.5.12+commit.7709ece9";
    const contractPath = "HistoricalLayout.sol";
    const contractName = "HistoricalLayout";
    const source = `
      pragma solidity 0.5.12;

      contract HistoricalLayout {
        struct Record {
          uint8 flag;
          uint16 count;
        }

        uint128 first;
        uint8 second;
        uint16[3] packed;
        mapping(address => Record) records;
        Record latest;
      }
    `;
    const jsonInput: SolidityJsonInput = {
      language: "Solidity",
      sources: { [contractPath]: { content: source } },
      settings: {
        optimizer: { enabled: false, runs: 200 },
        outputSelection: {
          "*": {
            "*": ["abi", "evm.bytecode.object"],
          },
        },
      },
    };
    const solc = serverFixture.server.app.get("solc") as ISolidityCompiler;
    const compilerOutput = await solc.compile(compilerVersion, jsonInput);
    const contractOutput = compilerOutput.contracts[contractPath][contractName];
    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        contractOutput.abi,
        `0x${contractOutput.evm.bytecode.object}`,
      );

    const verificationResponse = await chai
      .request(serverFixture.server.app)
      .post("/verify/solc-json")
      .attach("files", Buffer.from(JSON.stringify(jsonInput)), "solc.json")
      .field("address", contractAddress)
      .field("chain", chainFixture.chainId)
      .field("creatorTxHash", txHash)
      .field("compilerVersion", compilerVersion)
      .field("contractName", contractName);
    await assertVerification(
      serverFixture,
      null,
      verificationResponse,
      null,
      contractAddress,
      chainFixture.chainId,
      "perfect",
    );

    const addressBuffer = Buffer.from(contractAddress.substring(2), "hex");
    const storedResult = await serverFixture.sourcifyDatabase.query(
      `SELECT cc.id, cc.compilation_artifacts
         FROM verified_contracts vc
         JOIN contract_deployments cd ON cd.id = vc.deployment_id
         JOIN compiled_contracts cc ON cc.id = vc.compilation_id
         WHERE cd.chain_id = $1 AND cd.address = $2`,
      [chainFixture.chainId, addressBuffer],
    );
    chai.expect(storedResult.rows).to.have.length(1);
    const compilationId = storedResult.rows[0].id;
    const originalArtifacts = storedResult.rows[0].compilation_artifacts;
    chai
      .expect(
        originalArtifacts.storageLayout.storage.map(
          ({ label, offset, slot }: Record<string, unknown>) => ({
            label,
            offset,
            slot,
          }),
        ),
      )
      .to.deep.equal([
        { label: "first", offset: 0, slot: "0" },
        { label: "second", offset: 16, slot: "0" },
        { label: "packed", offset: 0, slot: "1" },
        { label: "records", offset: 0, slot: "2" },
        { label: "latest", offset: 0, slot: "3" },
      ]);

    await serverFixture.sourcifyDatabase.query(
      `UPDATE compiled_contracts
         SET compilation_artifacts = jsonb_set(
           compilation_artifacts, '{storageLayout}', 'null'::jsonb)
         WHERE id = $1`,
      [compilationId],
    );

    const replaceBody = {
      address: contractAddress,
      chainId: chainFixture.chainId,
      forceCompilation: true,
      forceRPCRequest: false,
      customReplaceMethod: "replace-solidity-storage-layout",
      jsonInput,
      compilerVersion,
      compilationTarget: `${contractPath}:${contractName}`,
    };
    const mismatchedSourceResponse = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", "Bearer sourcify-test-token")
      .send({
        ...replaceBody,
        jsonInput: {
          ...jsonInput,
          sources: {
            [contractPath]: { content: `${source}\n` },
          },
        },
      });
    chai
      .expect(mismatchedSourceResponse.status)
      .to.equal(StatusCodes.BAD_REQUEST);
    chai
      .expect(mismatchedSourceResponse.body.message)
      .to.contain("compilation identity does not match");

    const replaceResponse = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", "Bearer sourcify-test-token")
      .send(replaceBody);
    chai.expect(replaceResponse.status).to.equal(StatusCodes.OK);
    chai.expect(replaceResponse.body.replaced).to.be.true;

    const restoredResult = await serverFixture.sourcifyDatabase.query(
      "SELECT compilation_artifacts FROM compiled_contracts WHERE id = $1",
      [compilationId],
    );
    chai
      .expect(restoredResult.rows[0].compilation_artifacts)
      .to.deep.equal(originalArtifacts);

    const lookupResponse = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${contractAddress}?fields=storageLayout`,
      );
    chai.expect(lookupResponse.status).to.equal(StatusCodes.OK);
    chai
      .expect(lookupResponse.body.storageLayout)
      .to.deep.equal(originalArtifacts.storageLayout);

    const repeatedReplaceResponse = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", "Bearer sourcify-test-token")
      .send(replaceBody);
    chai
      .expect(repeatedReplaceResponse.status)
      .to.equal(StatusCodes.BAD_REQUEST);
    chai
      .expect(repeatedReplaceResponse.body.message)
      .to.contain("storageLayout is already populated");
  });
});
