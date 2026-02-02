import type { Devdoc, Userdoc } from "@ethereum-sourcify/lib-sourcify";
import type { VerificationTestCase } from "../../verification-cases.spec";

// store auxdata for a Vyper contract compiled with 0.3.8
export default {
  onchain: {
    creationBytecode:
      "0x6100a361000f6000396100a36000f360003560e01c346100915763c605f76c811861008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181516020830160208301815181525050808252508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b5060006000fd5b600080fda165767970657283000308000b",
    deployedBytecode:
      "0x60003560e01c346100915763c605f76c811861008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181516020830160208301815181525050808252508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b5060006000fd5b600080fda165767970657283000308000b",
  },
  input: {
    compilerVersion: "0.3.8+commit.036f1536",
    contractIdentifier: "test.vy:test",
    stdJsonInput: {
      language: "Vyper",
      sources: {
        "test.vy": {
          content:
            '# @version >=0.3.2\n\n# @notice Simple greeting contract\n\n# @notice Returns the string "Hello World!"\n# @notice The @external decorator means this function can only be called by external parties ie. by other contracts or by a wallet making a transaction\n# @notice The @view decorator means that this function can read the contract state but not alter it. Cannot consume gas.\n@external\n@view\ndef helloWorld() -> String[24]:\n    return "Hello World!"',
        },
      },
      settings: {
        evmVersion: "istanbul",
        libraries: {},
      },
    },
  },
  output: {
    creationBytecode:
      "0x6100a361000f6000396100a36000f360003560e01c346100915763c605f76c811861008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181516020830160208301815181525050808252508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b5060006000fd5b600080fda165767970657283000308000b",
    deployedBytecode:
      "0x60003560e01c346100915763c605f76c811861008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181516020830160208301815181525050808252508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b5060006000fd5b600080fda165767970657283000308000b",
    compilationArtifacts: {
      abi: [
        {
          stateMutability: "view",
          type: "function",
          name: "helloWorld",
          inputs: [],
          outputs: [{ name: "", type: "string" }],
        },
      ],
      sources: {
        "test.vy": {
          id: 0,
        },
      },
      devdoc: {},
      userdoc: {},
      storageLayout: null,
    },
    creationCodeArtifacts: {
      sourceMap: null,
      linkReferences: null,
      cborAuxdata: {
        "1": {
          offset: 165,
          value: "0xa165767970657283000308000b",
        },
      },
    },
    runtimeCodeArtifacts: {
      sourceMap:
        "-1:-1:0:-;;;;;;:::-;389:57;;;;:::-;-1:-1;;;;;;432:14;-1:-1;;432:14;;-1:-1;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;389:57;;:::-;-1:-1;;;;:::-;;;",
      immutableReferences: null,
      linkReferences: null,
      cborAuxdata: {
        "1": {
          offset: 150,
          value: "0xa165767970657283000308000b",
        },
      },
    },
    metadata: {
      compiler: {
        version: "0.3.8+commit.036f1536",
      },
      language: "Vyper",
      output: {
        abi: [
          {
            inputs: [],
            name: "helloWorld",
            outputs: [
              {
                name: "",
                type: "string",
              },
            ],
            stateMutability: "view",
            type: "function",
          },
        ],
        devdoc: {} as Devdoc,
        userdoc: {} as Userdoc,
      },
      settings: {
        evmVersion: "istanbul",
        libraries: {},
        compilationTarget: {
          "test.vy": "test",
        },
      },
      sources: {
        "test.vy": {
          keccak256:
            "0xa5f556e807a453ac8289c2a75a1d1b42f12d46cd21b58975b6f623cb940125c9",
        },
      },
      version: 1,
    },
  },
  verification: {
    creationMatch: "match",
    runtimeMatch: "match",
    creationTransformations: [],
    creationValues: {},
    runtimeTransformations: [],
    runtimeValues: {},
  },
} as const satisfies VerificationTestCase;
