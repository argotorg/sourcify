import type { VerificationExport } from "@ethereum-sourcify/lib-sourcify";

export const MockVerificationExport: VerificationExport = {
  address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  chainId: 31337,
  status: {
    runtimeMatch: "perfect",
    creationMatch: "perfect",
  },
  onchainRuntimeBytecode:
    "0x6080604052348015600f57600080fd5b506004361060325760003560e01c80632e64cec11460375780636057361d146051575b600080fd5b603d6069565b6040516048919060c2565b60405180910390f35b6067600480360381019060639190608f565b6072565b005b60008054905090565b8060008190555050565b60008135905060898160e5565b92915050565b60006020828403121560a057600080fd5b600060ac84828501607c565b91505092915050565b60bc8160db565b82525050565b600060208201905060d5600083018460b5565b92915050565b6000819050919050565b60ec8160db565b811460f657600080fd5b5056fea264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033",
  onchainCreationBytecode:
    "0x608060405234801561001057600080fd5b5061012f806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80632e64cec11460375780636057361d146051575b600080fd5b603d6069565b6040516048919060c2565b60405180910390f35b6067600480360381019060639190608f565b6072565b005b60008054905090565b8060008190555050565b60008135905060898160e5565b92915050565b60006020828403121560a057600080fd5b600060ac84828501607c565b91505092915050565b60bc8160db565b82525050565b600060208201905060d5600083018460b5565b92915050565b6000819050919050565b60ec8160db565b811460f657600080fd5b5056fea264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033",
  transformations: {
    runtime: {
      list: [],
      values: {},
    },
    creation: {
      list: [],
      values: {},
    },
  },
  deploymentInfo: {
    blockNumber: 1,
    txIndex: 0,
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    txHash:
      "0xdd419b049534d2ead35de292ce73f3a9d9ecad33cdc1da1cae1d9fa3a86c74e1",
  },
  libraryMap: {
    runtime: {},
    creation: {},
  },
  compilation: {
    language: "Solidity",
    compilationTarget: {
      path: "project:/contracts/Storage.sol",
      name: "Storage",
    },
    compilerVersion: "0.8.4+commit.c7e474f2",
    sources: {
      "project:/contracts/Storage.sol":
        "// SPDX-License-Identifier: GPL-3.0\n\npragma solidity >=0.7.0 <0.9.0;\n\n/**\n * @title Storage\n * @dev Store & retrieve value in a variable\n */\ncontract Storage {\n\n    uint256 number;\n\n    /**\n     * @dev Store value in variable\n     * @param num value to store\n     */\n    function store(uint256 num) public {\n        number = num;\n    }\n\n    /**\n     * @dev Return value \n     * @return value of 'number'\n     */\n    function retrieve() public view returns (uint256){\n        return number;\n    }\n}\n",
    },
    compilerOutput: {
      sources: {
        "project:/contracts/Storage.sol": {
          id: 0,
        },
      },
    },
    contractCompilerOutput: {
      abi: [
        {
          inputs: [],
          name: "retrieve",
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
              name: "num",
              type: "uint256",
            },
          ],
          name: "store",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
      ],
      userdoc: {
        kind: "user",
        methods: {},
        version: 1,
      },
      devdoc: {
        details: "Store & retrieve value in a variable",
        kind: "dev",
        methods: {
          "retrieve()": {
            details: "Return value ",
            returns: {
              _0: "value of 'number'",
            },
          },
          "store(uint256)": {
            details: "Store value in variable",
            params: {
              num: "value to store",
            },
          },
        },
        title: "Storage",
        version: 1,
      },
      storageLayout: {
        storage: [
          {
            astId: 4,
            contract: "project:/contracts/Storage.sol:Storage",
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
      evm: {
        bytecode: {
          sourceMap: "141:356:0:-:0;;;;;;;;;;;;;;;;;;;",
          linkReferences: {},
        },
        deployedBytecode: {
          sourceMap:
            "141:356:0:-:0;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;416:79;;;:::i;:::-;;;;;;;:::i;:::-;;;;;;;;271:64;;;;;;;;;;;;;:::i;:::-;;:::i;:::-;;416:79;457:7;482:6;;475:13;;416:79;:::o;271:64::-;325:3;316:6;:12;;;;271:64;:::o;7:139:1:-;53:5;91:6;78:20;69:29;;107:33;134:5;107:33;:::i;:::-;59:87;;;;:::o;152:262::-;211:6;260:2;248:9;239:7;235:23;231:32;228:2;;;276:1;273;266:12;228:2;319:1;344:53;389:7;380:6;369:9;365:22;344:53;:::i;:::-;334:63;;290:117;218:196;;;;:::o;420:118::-;507:24;525:5;507:24;:::i;:::-;502:3;495:37;485:53;;:::o;544:222::-;637:4;675:2;664:9;660:18;652:26;;688:71;756:1;745:9;741:17;732:6;688:71;:::i;:::-;642:124;;;;:::o;772:77::-;809:7;838:5;827:16;;817:32;;;:::o;855:122::-;928:24;946:5;928:24;:::i;:::-;921:5;918:35;908:2;;967:1;964;957:12;908:2;898:79;:::o",
          linkReferences: {},
        },
      },
    },
    runtimeBytecode:
      "0x6080604052348015600f57600080fd5b506004361060325760003560e01c80632e64cec11460375780636057361d146051575b600080fd5b603d6069565b6040516048919060c2565b60405180910390f35b6067600480360381019060639190608f565b6072565b005b60008054905090565b8060008190555050565b60008135905060898160e5565b92915050565b60006020828403121560a057600080fd5b600060ac84828501607c565b91505092915050565b60bc8160db565b82525050565b600060208201905060d5600083018460b5565b92915050565b6000819050919050565b60ec8160db565b811460f657600080fd5b5056fea264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033",
    creationBytecode:
      "0x608060405234801561001057600080fd5b5061012f806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80632e64cec11460375780636057361d146051575b600080fd5b603d6069565b6040516048919060c2565b60405180910390f35b6067600480360381019060639190608f565b6072565b005b60008054905090565b8060008190555050565b60008135905060898160e5565b92915050565b60006020828403121560a057600080fd5b600060ac84828501607c565b91505092915050565b60bc8160db565b82525050565b600060208201905060d5600083018460b5565b92915050565b6000819050919050565b60ec8160db565b811460f657600080fd5b5056fea264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033",
    runtimeBytecodeCborAuxdata: {
      "1": {
        offset: 250,
        value:
          "0xa264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033",
      },
    },
    creationBytecodeCborAuxdata: {
      "1": {
        offset: 282,
        value:
          "0xa264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033",
      },
    },
    immutableReferences: {},
    metadata: {
      compiler: {
        version: "0.8.4+commit.c7e474f2",
      },
      language: "Solidity",
      output: {
        abi: [
          {
            inputs: [],
            name: "retrieve",
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
                name: "num",
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
            "retrieve()": {
              details: "Return value ",
              returns: {
                _0: "value of 'number'",
              },
            },
            "store(uint256)": {
              details: "Store value in variable",
              params: {
                num: "value to store",
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
          "project:/contracts/Storage.sol": "Storage",
        },
        evmVersion: "istanbul",
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
        "project:/contracts/Storage.sol": {
          keccak256:
            "0x88c47206b5ec3d60ab820e9d126c4ac54cb17fa7396ff49ebe27db2862982ad8",
          license: "GPL-3.0",
          urls: [
            "bzz-raw://5d1eeb01c8c10bed9e290f4a80a8d4081422a7b298a13049d72867022522cf6b",
            "dweb:/ipfs/QmaFRC9ZtT7y3t9XNWCbDuMTEwKkyaQJzYFzw3NbeohSn5",
          ],
        },
      },
      version: 1,
    },
    jsonInput: {
      settings: {
        evmVersion: "istanbul",
        libraries: {},
        metadata: {
          bytecodeHash: "ipfs",
        },
        optimizer: {
          enabled: false,
          runs: 200,
        },
        remappings: [],
        outputSelection: {
          "*": {
            "*": [
              "abi",
              "devdoc",
              "userdoc",
              "storageLayout",
              "evm.legacyAssembly",
              "evm.bytecode.object",
              "evm.bytecode.sourceMap",
              "evm.bytecode.linkReferences",
              "evm.bytecode.generatedSources",
              "evm.deployedBytecode.object",
              "evm.deployedBytecode.sourceMap",
              "evm.deployedBytecode.linkReferences",
              "evm.deployedBytecode.immutableReferences",
              "metadata",
            ],
          },
        },
      },
    },
    compilationTime: 56,
  },
};
