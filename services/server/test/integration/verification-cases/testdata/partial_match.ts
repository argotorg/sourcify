import type { VerificationTestCase } from "../verification-cases.spec";

// Store partial match in database
export default {
  onchain: {
    creationBytecode:
      "0x608060405234801561001057600080fd5b50610133806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80636057361d1460375780638381f58a14604f575b600080fd5b604d60048036038101906049919060af565b6069565b005b60556073565b6040516060919060e4565b60405180910390f35b8060008190555050565b60005481565b600080fd5b6000819050919050565b608f81607e565b8114609957600080fd5b50565b60008135905060a9816088565b92915050565b60006020828403121560c25760c16079565b5b600060ce84828501609c565b91505092915050565b60de81607e565b82525050565b600060208201905060f7600083018460d7565b9291505056fea26469706673582212204ac0ce5f82b26331fa3e9ae959291a55624ffaf90fcd509deafcc21a5f1da21e64736f6c63430008120033",
    deployedBytecode:
      "0x6080604052348015600f57600080fd5b506004361060325760003560e01c80636057361d1460375780638381f58a14604f575b600080fd5b604d60048036038101906049919060af565b6069565b005b60556073565b6040516060919060e4565b60405180910390f35b8060008190555050565b60005481565b600080fd5b6000819050919050565b608f81607e565b8114609957600080fd5b50565b60008135905060a9816088565b92915050565b60006020828403121560c25760c16079565b5b600060ce84828501609c565b91505092915050565b60de81607e565b82525050565b600060208201905060f7600083018460d7565b9291505056fea26469706673582212204ac0ce5f82b26331fa3e9ae959291a55624ffaf90fcd509deafcc21a5f1da21e64736f6c63430008120033",
  },
  input: {
    compilerVersion: "0.8.18+commit.87f61d96",
    contractIdentifier: "contracts/1_Storage.sol:Storage",
    stdJsonInput: {
      language: "Solidity",
      sources: {
        "contracts/1_Storage.sol": {
          content:
            "// SPDX-License-Identifier: GPL-3.0\n\npragma solidity >=0.7.0 <0.9.0;\n\n/**\n * @title Storage\n * @dev Store & retrieve value in a variable\n */\ncontract Storage {\n    uint256 public number;\n\n    /**\n     * @dev Store value in variable\n     * @param modified_num value to store\n     */\n    function store(uint256 modified_num) public {\n        number = modified_num;\n    }\n}",
        },
      },
      settings: {
        evmVersion: "paris",
        metadata: {
          bytecodeHash: "ipfs",
        },
        optimizer: {
          enabled: false,
          runs: 200,
        },
        libraries: {},
        remappings: [],
      },
    },
  },
  output: {
    creationBytecode:
      "0x608060405234801561001057600080fd5b50610133806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80636057361d1460375780638381f58a14604f575b600080fd5b604d60048036038101906049919060af565b6069565b005b60556073565b6040516060919060e4565b60405180910390f35b8060008190555050565b60005481565b600080fd5b6000819050919050565b608f81607e565b8114609957600080fd5b50565b60008135905060a9816088565b92915050565b60006020828403121560c25760c16079565b5b600060ce84828501609c565b91505092915050565b60de81607e565b82525050565b600060208201905060f7600083018460d7565b9291505056fea26469706673582212203863ce629eb61798cd34ba5d73d729ef1f86d2529ee1bdfc20e7eda860c4260564736f6c63430008120033",
    deployedBytecode:
      "0x6080604052348015600f57600080fd5b506004361060325760003560e01c80636057361d1460375780638381f58a14604f575b600080fd5b604d60048036038101906049919060af565b6069565b005b60556073565b6040516060919060e4565b60405180910390f35b8060008190555050565b60005481565b600080fd5b6000819050919050565b608f81607e565b8114609957600080fd5b50565b60008135905060a9816088565b92915050565b60006020828403121560c25760c16079565b5b600060ce84828501609c565b91505092915050565b60de81607e565b82525050565b600060208201905060f7600083018460d7565b9291505056fea26469706673582212203863ce629eb61798cd34ba5d73d729ef1f86d2529ee1bdfc20e7eda860c4260564736f6c63430008120033",
    compilationArtifacts: {
      abi: [
        {
          inputs: [],
          name: "number",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [
            {
              internalType: "uint256",
              name: "modified_num",
              type: "uint256",
            },
          ],
          name: "store",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
      ],
      devdoc: {
        details: "Store & retrieve value in a variable",
        kind: "dev",
        methods: {
          "store(uint256)": {
            details: "Store value in variable",
            params: { modified_num: "value to store" },
          },
        },
        title: "Storage",
        version: 1,
      },
      userdoc: { kind: "user", methods: {}, version: 1 },
      storageLayout: {
        storage: [
          {
            astId: 4,
            contract: "contracts/1_Storage.sol:Storage",
            label: "number",
            offset: 0,
            slot: "0",
            type: "t_uint256",
          },
        ],
        types: {
          t_uint256: {
            encoding: "inplace",
            label: "uint256",
            numberOfBytes: "32",
          },
        },
      },
      sources: { "contracts/1_Storage.sol": { id: 0 } },
    },
    creationCodeArtifacts: {
      linkReferences: {},
      sourceMap: "141:229:0:-:0;;;;;;;;;;;;;;;;;;;",
      cborAuxdata: {
        "1": {
          offset: 286,
          value:
            "0xa26469706673582212203863ce629eb61798cd34ba5d73d729ef1f86d2529ee1bdfc20e7eda860c4260564736f6c63430008120033",
        },
      },
    },
    runtimeCodeArtifacts: {
      immutableReferences: {},
      linkReferences: {},
      sourceMap:
        "141:229:0:-:0;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;286:82;;;;;;;;;;;;;:::i;:::-;;:::i;:::-;;164:21;;;:::i;:::-;;;;;;;:::i;:::-;;;;;;;;286:82;349:12;340:6;:21;;;;286:82;:::o;164:21::-;;;;:::o;88:117:1:-;197:1;194;187:12;334:77;371:7;400:5;389:16;;334:77;;;:::o;417:122::-;490:24;508:5;490:24;:::i;:::-;483:5;480:35;470:63;;529:1;526;519:12;470:63;417:122;:::o;545:139::-;591:5;629:6;616:20;607:29;;645:33;672:5;645:33;:::i;:::-;545:139;;;;:::o;690:329::-;749:6;798:2;786:9;777:7;773:23;769:32;766:119;;;804:79;;:::i;:::-;766:119;924:1;949:53;994:7;985:6;974:9;970:22;949:53;:::i;:::-;939:63;;895:117;690:329;;;;:::o;1025:118::-;1112:24;1130:5;1112:24;:::i;:::-;1107:3;1100:37;1025:118;;:::o;1149:222::-;1242:4;1280:2;1269:9;1265:18;1257:26;;1293:71;1361:1;1350:9;1346:17;1337:6;1293:71;:::i;:::-;1149:222;;;;:::o",
      cborAuxdata: {
        "1": {
          offset: 254,
          value:
            "0xa26469706673582212203863ce629eb61798cd34ba5d73d729ef1f86d2529ee1bdfc20e7eda860c4260564736f6c63430008120033",
        },
      },
    },
    metadata: {
      compiler: {
        version: "0.8.18+commit.87f61d96",
      },
      language: "Solidity",
      output: {
        abi: [
          {
            inputs: [],
            name: "number",
            outputs: [
              {
                internalType: "uint256",
                name: "",
                type: "uint256",
              },
            ],
            stateMutability: "view",
            type: "function",
          },
          {
            inputs: [
              {
                internalType: "uint256",
                name: "modified_num",
                type: "uint256",
              },
            ],
            name: "store",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        devdoc: {
          details: "Store & retrieve value in a variable",
          kind: "dev",
          methods: {
            "store(uint256)": {
              details: "Store value in variable",
              params: {
                modified_num: "value to store",
              },
            },
          },
          title: "Storage",
          version: 1,
        },
        userdoc: {
          kind: "user",
          methods: {},
          version: 1,
        },
      },
      settings: {
        compilationTarget: {
          "contracts/1_Storage.sol": "Storage",
        },
        evmVersion: "paris",
        libraries: {},
        metadata: {
          bytecodeHash: "ipfs",
        },
        optimizer: {
          enabled: false,
          runs: 200,
        },
        remappings: [],
      },
      sources: {
        "contracts/1_Storage.sol": {
          keccak256:
            "0x17b1b0e98d607a075ba0995b911b49166b21a45b58764dd4fa2c7c12ff5942fc",
          license: "GPL-3.0",
          urls: [
            "bzz-raw://24a035fe74693232e2d111417cf1b5210b3d500f9660392f0eab1a865f61ed06",
            "dweb:/ipfs/QmZVok6GBFUANqof9192mh6LXz759qh6nzrfrzf2C6nu6b",
          ],
        },
      },
      version: 1,
    },
  },
  verification: {
    creationMatch: "match",
    creationValues: {
      cborAuxdata: {
        "1": "0xa26469706673582212204ac0ce5f82b26331fa3e9ae959291a55624ffaf90fcd509deafcc21a5f1da21e64736f6c63430008120033",
      },
    },
    creationTransformations: [
      {
        type: "replace",
        reason: "cborAuxdata",
        offset: 286,
        id: "1",
      },
    ],
    runtimeMatch: "match",
    runtimeValues: {
      cborAuxdata: {
        "1": "0xa26469706673582212204ac0ce5f82b26331fa3e9ae959291a55624ffaf90fcd509deafcc21a5f1da21e64736f6c63430008120033",
      },
    },
    runtimeTransformations: [
      {
        type: "replace",
        reason: "cborAuxdata",
        offset: 254,
        id: "1",
      },
    ],
  },
} as const satisfies VerificationTestCase;
