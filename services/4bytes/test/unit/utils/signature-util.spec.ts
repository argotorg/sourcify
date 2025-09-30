import chai from "chai";
import {
  extractSignaturesFromAbi,
  getCanonicalSignatures,
} from "../../../src/utils/signature-util";
import { JsonFragment, id as keccak256str } from "ethers";

describe("4bytes signature-util", function () {
  describe("extractSignaturesFromAbi", function () {
    it("should extract all signature types from comprehensive ABI", function () {
      const abi: JsonFragment[] = [
        // Functions
        {
          inputs: [],
          name: "retrieve",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
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
        // Events
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
        // Errors
        {
          inputs: [
            { internalType: "address", name: "sender", type: "address" },
            { internalType: "uint256", name: "balance", type: "uint256" },
            { internalType: "uint256", name: "needed", type: "uint256" },
          ],
          name: "InsufficientBalance",
          type: "error",
        },
        {
          inputs: [
            { internalType: "uint256", name: "required", type: "uint256" },
            { internalType: "uint256", name: "available", type: "uint256" },
          ],
          name: "InsufficientValue",
          type: "error",
        },
        // Should be ignored: constructor, fallback, receive
        {
          inputs: [
            { internalType: "uint256", name: "initialValue", type: "uint256" },
          ],
          stateMutability: "nonpayable",
          type: "constructor",
        },
        {
          stateMutability: "payable",
          type: "fallback",
        },
        {
          stateMutability: "payable",
          type: "receive",
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      // Should extract 6 signatures: 2 functions + 2 events + 2 errors
      chai.expect(result).to.have.lengthOf(6);

      // Test functions
      const retrieveSig = result.find((r) => r.signature === "retrieve()");
      const transferSig = result.find(
        (r) => r.signature === "transfer(address,uint256)",
      );

      chai.expect(retrieveSig).to.exist;
      chai.expect(retrieveSig!.signatureType).to.equal("function");
      chai
        .expect(retrieveSig!.signatureHash32)
        .to.equal(keccak256str("retrieve()"));

      chai.expect(transferSig).to.exist;
      chai.expect(transferSig!.signatureType).to.equal("function");
      chai
        .expect(transferSig!.signatureHash32)
        .to.equal(keccak256str("transfer(address,uint256)"));

      // Test events
      const transferEventSig = result.find(
        (r) => r.signature === "Transfer(address,address,uint256)",
      );
      const valueChangedSig = result.find(
        (r) => r.signature === "ValueChanged(uint256)",
      );

      chai.expect(transferEventSig).to.exist;
      chai.expect(transferEventSig!.signatureType).to.equal("event");
      chai
        .expect(transferEventSig!.signatureHash32)
        .to.equal(keccak256str("Transfer(address,address,uint256)"));

      chai.expect(valueChangedSig).to.exist;
      chai.expect(valueChangedSig!.signatureType).to.equal("event");
      chai
        .expect(valueChangedSig!.signatureHash32)
        .to.equal(keccak256str("ValueChanged(uint256)"));

      // Test errors
      const insufficientBalanceSig = result.find(
        (r) => r.signature === "InsufficientBalance(address,uint256,uint256)",
      );
      const insufficientValueSig = result.find(
        (r) => r.signature === "InsufficientValue(uint256,uint256)",
      );

      chai.expect(insufficientBalanceSig).to.exist;
      chai.expect(insufficientBalanceSig!.signatureType).to.equal("error");
      chai
        .expect(insufficientBalanceSig!.signatureHash32)
        .to.equal(keccak256str("InsufficientBalance(address,uint256,uint256)"));

      chai.expect(insufficientValueSig).to.exist;
      chai.expect(insufficientValueSig!.signatureType).to.equal("error");
      chai
        .expect(insufficientValueSig!.signatureHash32)
        .to.equal(keccak256str("InsufficientValue(uint256,uint256)"));

      // Verify all signature hashes are valid hex strings
      result.forEach((sig) => {
        chai.expect(sig.signatureHash32).to.be.a("string");
        chai.expect(sig.signatureHash32).to.have.lengthOf(66);
        chai.expect(sig.signatureHash32).to.match(/^0x[a-fA-F0-9]{64}$/);
      });
    });

    it("should handle empty ABI", function () {
      const result = extractSignaturesFromAbi([]);
      chai.expect(result).to.be.an("array").that.is.empty;
    });

    it("should ignore invalid fragments", function () {
      const abi: JsonFragment[] = [
        {
          inputs: [{ internalType: "uint256", name: "num", type: "uint256" }],
          name: "store",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          // Invalid fragment with custom type - should be ignored
          name: "get",
          type: "function",
          inputs: [
            {
              name: "dataStore",
              type: "DataStore",
              internalType: "contract DataStore",
            },
          ],
        },
      ];

      const result = extractSignaturesFromAbi(abi);

      chai.expect(result).to.have.lengthOf(1);
      chai.expect(result[0].signatureType).to.equal("function");
      chai.expect(result[0].signature).to.equal("store(uint256)");
    });
  });

  describe("getCanonicalSignatures", function () {
    it("should return consistent object with valid structure", function () {
      const result1 = getCanonicalSignatures();
      const result2 = getCanonicalSignatures();

      // Should return consistent results
      chai.expect(result1).to.deep.equal(result2);

      // Should be an object
      chai.expect(result1).to.be.an("object");

      // Check structure of entries
      const entries = Object.entries(result1);
      entries.forEach(([hash, data]) => {
        chai.expect(hash).to.be.a("string");
        chai.expect(hash).to.match(/^0x[a-fA-F0-9]+$/); // Should be hex string

        if (
          data &&
          typeof data === "object" &&
          "signature" in data &&
          data.signature
        ) {
          chai.expect(data.signature).to.be.a("string");
          chai.expect(data.signature.length).to.be.greaterThan(0);
        }
      });
    });
  });
});
