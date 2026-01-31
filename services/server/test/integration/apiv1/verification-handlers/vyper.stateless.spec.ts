import chai from "chai";
import path from "path";
import fs from "fs";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import {
  deployFromAbiAndBytecode,
  deployFromAbiAndBytecodeForCreatorTxHash,
} from "../../../helpers/helpers";
import {
  assertTransformations,
  assertVerification,
} from "../../../helpers/assertions";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";
import type { VerifyVyperRequest } from "../../../../src/server/apiv1/verification/vyper/stateless/vyper.stateless.handlers";
import type { VyperSettings } from "@ethereum-sourcify/lib-sourcify";
import { AuxdataTransformation } from "@ethereum-sourcify/lib-sourcify";
import contractArtifact from "../../../sources/vyper/testcontract/artifact.json";

chai.use(chaiHttp);

describe("/verify/vyper", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  // Default test contract
  const contractFileName = "test.vy";
  const contractSourcePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "sources",
    "vyper",
    "testcontract",
    contractFileName,
  );
  const contractFileContent = fs.readFileSync(contractSourcePath);

  const deployAndVerifyVyperTestContract = async (
    additionalRequestOptions: Partial<VerifyVyperRequest["body"]> = {},
  ) => {
    const address = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      contractArtifact.abi,
      contractArtifact.bytecode,
    );
    const res = await verifyVyperTestContract(
      address,
      additionalRequestOptions,
    );
    return { res, address };
  };

  const verifyVyperTestContract = async (
    address: string,
    additionalRequestOptions: Partial<VerifyVyperRequest["body"]> = {},
  ) => {
    const res = await chai
      .request(serverFixture.server.app)
      .post("/verify/vyper")
      .send({
        address: address,
        chain: chainFixture.chainId,
        files: {
          [contractFileName]: contractFileContent.toString(),
        },
        contractPath: contractFileName,
        contractName: contractFileName.split(".")[0],
        compilerVersion: "0.3.10+commit.91361694",
        compilerSettings: {
          evmVersion: "istanbul",
          outputSelection: {
            "*": ["evm.bytecode"],
          },
        },
        ...additionalRequestOptions,
      });
    return res;
  };

  it("should verify a vyper contract resulting in a partial match", async () => {
    const { res, address } = await deployAndVerifyVyperTestContract();

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      address,
      chainFixture.chainId,
      "partial",
    );
  });

  it("should return an error if the files are not provided", async () => {
    const { res } = await deployAndVerifyVyperTestContract({ files: {} });

    chai.expect(res.status).to.equal(StatusCodes.NOT_FOUND);
    chai.expect(res.body).to.haveOwnProperty("error");
  });

  it("should return an error if the compiler input is invalid", async () => {
    const { res } = await deployAndVerifyVyperTestContract({
      compilerSettings: {
        // Invalid EVM version
        evmVersion: "invalidEvm" as VyperSettings["evmVersion"],
        outputSelection: {
          "*": ["evm.bytecode"],
        },
      },
    });

    chai.expect(res.status).to.equal(StatusCodes.INTERNAL_SERVER_ERROR);
    chai.expect(res.body).to.haveOwnProperty("error");
  });

  it("should return an error if the contract is already verified", async () => {
    const { address } = await deployAndVerifyVyperTestContract();

    const res = await verifyVyperTestContract(address);

    chai.expect(res.status).to.equal(StatusCodes.CONFLICT);
    chai.expect(res.body).to.haveOwnProperty("error");
  });

  it("should return an error if the deployed and recompiled bytecodes mismatch", async () => {
    const contract2Artifact = (
      await import("../../../sources/vyper/testcontract2/artifact.json")
    ).default;

    const contract2Address = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      contract2Artifact.abi,
      contract2Artifact.bytecode,
    );

    // Uses the default testcontract files to verify
    const res = await verifyVyperTestContract(contract2Address);

    chai.expect(res.status).to.equal(StatusCodes.INTERNAL_SERVER_ERROR);
    chai.expect(res.body).to.haveOwnProperty("error");
  });

  it("should have an auxdata transformation for a contract with a wrong integrity hash on chain", async () => {
    const creationCodeWithWrongIntegrityHash =
      "0x61008f61000f60003961008f6000f360003560e01c63c605f76c8118610084573461008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518152602082015160208201528051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b60006000fd5b600080fd8558201111111111111111111111111111111111111111111111111111111111111111188f8000a1657679706572830004010034";
    const { contractAddress: address, txHash: creatorTxHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        contractArtifact.abi,
        creationCodeWithWrongIntegrityHash,
      );

    const res = await verifyVyperTestContract(address, {
      compilerVersion: "0.4.1b1+commit.039d3692",
      compilerSettings: {
        evmVersion: "london",
        outputSelection: {
          "*": ["evm.bytecode"],
        },
      },
      creatorTxHash,
    });

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      address,
      chainFixture.chainId,
      "partial",
    );

    await assertTransformations(
      serverFixture.sourcifyDatabase,
      address,
      chainFixture.chainId,
      [],
      {},
      [AuxdataTransformation("replace", 158, "1")],
      {
        cborAuxdata: {
          "1": "0x8558201111111111111111111111111111111111111111111111111111111111111111188f8000a1657679706572830004010034",
        },
      },
    );
  });

  it("should have an auxdata transformation for a contract with a wrong cbor auxdata on Vyper 0.3.8", async () => {
    const creationCodeWithWrongVyperVersion =
      "0x6100a361000f6000396100a36000f360003560e01c346100915763c605f76c811861008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181516020830160208301815181525050808252508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b5060006000fd5b600080fda165767970657283000307000b";
    const { contractAddress: address, txHash: creatorTxHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        contractArtifact.abi,
        creationCodeWithWrongVyperVersion,
      );

    const res = await verifyVyperTestContract(address, {
      compilerVersion: "0.3.8+commit.036f1536",
      compilerSettings: {
        evmVersion: "istanbul",
        outputSelection: {
          "*": ["evm.bytecode"],
        },
      },
      creatorTxHash,
    });

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      address,
      chainFixture.chainId,
      "partial",
    );

    await assertTransformations(
      serverFixture.sourcifyDatabase,
      address,
      chainFixture.chainId,
      [AuxdataTransformation("replace", 150, "1")],
      {
        cborAuxdata: {
          "1": "0xa165767970657283000307000b",
        },
      },
      [AuxdataTransformation("replace", 165, "1")],
      {
        cborAuxdata: {
          "1": "0xa165767970657283000307000b",
        },
      },
    );
  });

  it("should have an auxdata transformation for a contract with a wrong cbor auxdata on Vyper 0.3.4", async () => {
    const creationCodeWithWrongVyperVersion =
      "0x6100b761000f6000396100b76000f36003361161000c576100a1565b60003560e01c346100a75763c605f76c811861009f57600436186100a757602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518082526020830160208301815181525050508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b505b60006000fd5b600080fda165767970657283000303";
    const { contractAddress: address, txHash: creatorTxHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        contractArtifact.abi,
        creationCodeWithWrongVyperVersion,
      );

    const res = await verifyVyperTestContract(address, {
      compilerVersion: "0.3.4+commit.f31f0ec4",
      compilerSettings: {
        evmVersion: "istanbul",
        outputSelection: {
          "*": ["evm.bytecode"],
        },
      },
      creatorTxHash,
    });

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      address,
      chainFixture.chainId,
      "partial",
    );

    await assertTransformations(
      serverFixture.sourcifyDatabase,
      address,
      chainFixture.chainId,
      [AuxdataTransformation("replace", 172, "1")],
      {
        cborAuxdata: {
          "1": "0xa165767970657283000303",
        },
      },
      [AuxdataTransformation("replace", 187, "1")],
      {
        cborAuxdata: {
          "1": "0xa165767970657283000303",
        },
      },
    );
  });
});
