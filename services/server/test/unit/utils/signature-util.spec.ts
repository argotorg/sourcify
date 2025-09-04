import chai from "chai";
import { extractSignaturesFromAbi } from "../../../src/server/services/utils/signature-util";
import { JsonFragment, id as keccak256str } from "ethers";

describe("signature-util", function () {
  describe("extractSignaturesFromAbi", function () {
    it("should extract function signatures", function () {
      const abi: JsonFragment[] = [
        {
          inputs: [],
          name: "retrieve",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [{ internalType: "uint256", name: "num", type: "uint256" }],
          name: "store",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(2);

      const retrieveSig = result.find((r) => r.signature === "retrieve()");
      const storeSig = result.find((r) => r.signature === "store(uint256)");

      chai.expect(retrieveSig).to.exist;
      chai.expect(retrieveSig!.signatureType).to.equal("function");
      chai
        .expect(retrieveSig!.signatureHash32)
        .to.equal(keccak256str(retrieveSig!.signature));

      chai.expect(storeSig).to.exist;
      chai.expect(storeSig!.signatureType).to.equal("function");
      chai
        .expect(storeSig!.signatureHash32)
        .to.equal(keccak256str(storeSig!.signature));
    });

    it("should ignore constructor signatures", function () {
      const abi: JsonFragment[] = [
        {
          inputs: [
            {
              internalType: "uint256",
              name: "a",
              type: "uint256",
            },
          ],
          stateMutability: "nonpayable",
          type: "constructor",
        },
        {
          inputs: [],
          name: "getValue",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(1);
      chai.expect(result[0].signatureType).to.equal("function");
      chai.expect(result[0].signature).to.equal("getValue()");
    });

    it("should extract event signatures", function () {
      const abi: JsonFragment[] = [
        {
          anonymous: false,
          inputs: [
            {
              indexed: true,
              internalType: "address",
              name: "owner",
              type: "address",
            },
            {
              indexed: true,
              internalType: "address",
              name: "spender",
              type: "address",
            },
            {
              indexed: false,
              internalType: "uint256",
              name: "value",
              type: "uint256",
            },
          ],
          name: "Approval",
          type: "event",
        },
        {
          anonymous: false,
          inputs: [
            {
              indexed: true,
              internalType: "address",
              name: "from",
              type: "address",
            },
            {
              indexed: true,
              internalType: "address",
              name: "to",
              type: "address",
            },
            {
              indexed: false,
              internalType: "uint256",
              name: "value",
              type: "uint256",
            },
          ],
          name: "Transfer",
          type: "event",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(2);

      const approvalSig = result.find(
        (r) => r.signature === "Approval(address,address,uint256)",
      );
      const transferSig = result.find(
        (r) => r.signature === "Transfer(address,address,uint256)",
      );

      chai.expect(approvalSig).to.exist;
      chai.expect(approvalSig!.signatureType).to.equal("event");
      chai
        .expect(approvalSig!.signatureHash32)
        .to.equal(keccak256str(approvalSig!.signature));

      chai.expect(transferSig).to.exist;
      chai.expect(transferSig!.signatureType).to.equal("event");
      chai
        .expect(transferSig!.signatureHash32)
        .to.equal(keccak256str(transferSig!.signature));
    });

    it("should extract error signatures", function () {
      const abi: JsonFragment[] = [
        {
          inputs: [
            { internalType: "address", name: "spender", type: "address" },
            { internalType: "uint256", name: "allowance", type: "uint256" },
            { internalType: "uint256", name: "needed", type: "uint256" },
          ],
          name: "ERC20InsufficientAllowance",
          type: "error",
        },
        {
          inputs: [
            { internalType: "address", name: "sender", type: "address" },
            { internalType: "uint256", name: "balance", type: "uint256" },
            { internalType: "uint256", name: "needed", type: "uint256" },
          ],
          name: "ERC20InsufficientBalance",
          type: "error",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(2);
      chai.expect(result[0].signatureType).to.equal("error");
      chai
        .expect(result[0].signature)
        .to.equal("ERC20InsufficientAllowance(address,uint256,uint256)");
      chai
        .expect(result[0].signatureHash32)
        .to.equal(keccak256str(result[0].signature));
      chai.expect(result[1].signatureType).to.equal("error");
      chai
        .expect(result[1].signature)
        .to.equal("ERC20InsufficientBalance(address,uint256,uint256)");
      chai
        .expect(result[1].signatureHash32)
        .to.equal(keccak256str(result[1].signature));
    });

    it("should handle mixed ABI with functions and events (ignoring constructors)", function () {
      const abi: JsonFragment[] = [
        {
          inputs: [
            { internalType: "uint256", name: "initialValue", type: "uint256" },
          ],
          stateMutability: "nonpayable",
          type: "constructor",
        },
        {
          inputs: [],
          name: "getValue",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
        {
          anonymous: false,
          inputs: [
            {
              indexed: false,
              internalType: "uint256",
              name: "newValue",
              type: "uint256",
            },
          ],
          name: "ValueChanged",
          type: "event",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(2);

      const functionSig = result.find((r) => r.signatureType === "function");
      const eventSig = result.find((r) => r.signatureType === "event");

      chai.expect(functionSig).to.exist;
      chai.expect(eventSig).to.exist;

      chai.expect(functionSig!.signature).to.equal("getValue()");
      chai.expect(eventSig!.signature).to.equal("ValueChanged(uint256)");
    });

    it("should handle empty ABI", function () {
      const result = extractSignaturesFromAbi([]);
      chai.expect(result).to.be.an("array").that.is.empty;
    });

    it("should ignore fallback and receive functions", function () {
      const abi: JsonFragment[] = [
        {
          stateMutability: "payable",
          type: "fallback",
        },
        {
          stateMutability: "payable",
          type: "receive",
        },
        {
          inputs: [],
          name: "getValue",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(1);
      chai.expect(result[0].signatureType).to.equal("function");
      chai.expect(result[0].signature).to.equal("getValue()");
    });

    it("should generate correct signature hashes", function () {
      const abi: JsonFragment[] = [
        {
          inputs: [
            { internalType: "address", name: "to", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
          ],
          name: "transfer",
          outputs: [{ internalType: "bool", name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(1);
      chai.expect(result[0].signature).to.equal("transfer(address,uint256)");
      chai.expect(result[0].signatureHash32).to.be.a("string");
      chai.expect(result[0].signatureHash32).to.have.lengthOf(66);
      chai.expect(result[0].signatureHash32).to.match(/^0x[a-fA-F0-9]{64}$/);
    });

    it("should handle complex function signatures with arrays and tuples", function () {
      const abi: JsonFragment[] = [
        {
          inputs: [
            { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
            {
              internalType: "address[]",
              name: "recipients",
              type: "address[]",
            },
            {
              components: [
                { internalType: "uint256", name: "deadline", type: "uint256" },
                { internalType: "uint8", name: "v", type: "uint8" },
                { internalType: "bytes32", name: "r", type: "bytes32" },
                { internalType: "bytes32", name: "s", type: "bytes32" },
              ],
              internalType: "struct Permit",
              name: "permit",
              type: "tuple",
            },
          ],
          name: "batchTransferWithPermit",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(1);
      chai
        .expect(result[0].signature)
        .to.equal(
          "batchTransferWithPermit(uint256[],address[],(uint256,uint8,bytes32,bytes32))",
        );
      chai.expect(result[0].signatureType).to.equal("function");
      chai
        .expect(result[0].signatureHash32)
        .to.equal(keccak256str(result[0].signature));
    });
  });
});
