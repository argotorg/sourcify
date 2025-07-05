# lib-sourcify v2

[![codecov](https://codecov.io/gh/ethereum/sourcify/branch/staging/graph/badge.svg?token=eN6XDAwWfV&flag=lib-sourcify)](https://codecov.io/gh/ethereum/sourcify)

lib-sourcify is [Sourcify](https://sourcify.dev)'s reusable backbone library for verifying contracts. Version 2 introduces a completely redesigned architecture with improved abstractions, better support for both Solidity and Vyper contracts, a more flexible verification process, and browser support.

## Overview

lib-sourcify provides tools to validate, compile, and verify smart contracts.

The library supports verification with Solidity metadata.json and with both Solidity and Vyper's standard-JSON input formats

## Installation

```bash
npm install @ethereum-sourcify/lib-sourcify
```

## Quick Start

```typescript
import {
  SolidityCompilation,
  Verification,
  SourcifyChain,
  ISolidityCompiler,
  SolidityJsonInput,
  SolidityOutput,
} from "@ethereum-sourcify/lib-sourcify";
import { useSolidityCompiler } from "@ethereum-sourcify/compilers";
import * as fs from "fs";

// Step 1: Setup your compiler
class Solc implements ISolidityCompiler {
  private solcRepoPath: string;
  private solJsonRepoPath: string;

  constructor(solcRepoPath: string, solJsonRepoPath: string) {
    this.solcRepoPath = solcRepoPath;
    this.solJsonRepoPath = solJsonRepoPath;
  }

  async compile(
    version: string,
    solcJsonInput: SolidityJsonInput,
    forceEmscripten: boolean = false
  ): Promise<SolidityOutput> {
    return await useSolidityCompiler(
      this.solcRepoPath, // useSolidityCompiler will automatically download and store solc here
      this.solJsonRepoPath, // useSolidityCompiler will automatically download and store solcjs here
      version,
      solcJsonInput,
      forceEmscripten
    );
  }
}

const solc = new Solc("/path/to/solc", "/path/to/solcjs");

// Step 2: Prepare your standard JSON input
const jsonInput = {
  language: "Solidity",
  sources: {
    "Contract.sol": {
      content: "contract MyContract { function foo() public {} }",
    },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    outputSelection: {
      "*": [],
    },
  },
} as SolidityJsonInput;

// Step 3: Create a compilation
const compilation = new SolidityCompilation(
  solc,
  "0.8.20", // compiler version
  jsonInput,
  {
    path: "Contract.sol",
    name: "MyContract", // The name of your contract
  }
);

// Step 4: Set up a SourcifyChain instance
const myChain = new SourcifyChain({
  name: "My EVM Chain",
  chainId: 1337,
  rpc: ["http://localhost:8545"],
  supported: true,
});

// Step 5: Verify the contract
const verification = new Verification(
  compilation,
  myChain,
  "0xc0ffee254729296a45a3885639AC7E10F9d54979"
);

await verification.verify();

// Step 6: Check verification status
console.log(verification.status); // { runtimeMatch: 'perfect', creationMatch: null }
```

This example shows the complete verification flow for a Solidity contract using standard JSON input. For Vyper contracts or more advanced use cases, see the detailed sections below.

## Using in browser

For browser usage, we recommend using [web-solc](https://github.com/gnidan/web-solc) instead of `@ethereum-sourcify/compilers`. Here's an example of how to implement the `ISolidityCompiler` interface with `web-solc`:

```typescript
import { ISolidityCompiler, SolidityJsonInput } from "@ethereum-sourcify/lib-sourcify";
import { fetchSolc } from "web-solc";

class Solc implements ISolidityCompiler {
  async compile(
    version: string,
    solcJsonInput: SolidityJsonInput
  ): Promise<any> {
    const { compile } = await fetchSolc(version);
    return await compile(solcJsonInput);
  }
}

const solc = new Solc();
```

## Architecture

lib-sourcify v2 consists of several key components:

- **Validation**: Based on a Solidity metadata.json file that describes a contract build, checks if all source files are present and valid. Fetches missing sources from IPFS if necessary.

  - `SolidityMetadataContract`: Represents a Solidity contract with its metadata and source files
  - `processFiles.ts`: Utility functions for creating `SolidityMetadataContract` instances from files

- **Compilation**: Handles contract compilation

  - `AbstractCompilation`: Base class for compilation
  - `SolidityCompilation`: Handles Solidity compilation
  - `VyperCompilation`: Handles Vyper compilation

- **SourcifyChain**: Handles blockchain interactions such as fetching bytecode and transaction data

- **Verification**: Compares compiled bytecode from a `Compilation` with an on-chain bytecode from a `SourcifyChain`
  - `Verification`: Main class orchestrating the verification process

## Configuration

### RPC Timeout Configuration

You can set a global timeout for all RPC requests through the `SourcifyChain` class:

```typescript
import { SourcifyChain } from '@ethereum-sourcify/lib-sourcify';

// Set global RPC timeout to 30 seconds
SourcifyChain.setGlobalRpcTimeout(30 * 1000);

// Get the current global RPC timeout
const timeout = SourcifyChain.getGlobalRpcTimeout(); // Default is 10 seconds
```

### IPFS Gateway Configuration

You can configure the IPFS gateway used for fetching missing sources:

```typescript
import { SolidityMetadataContract } from '@ethereum-sourcify/lib-sourcify';

// Set a custom IPFS gateway
SolidityMetadataContract.setGlobalIpfsGateway({
  url: 'https://my-ipfs-gateway.com/ipfs/',
  headers: { 'Authorization': 'Bearer my-token' }
});

// Get the current IPFS gateway configuration
const gateway = SolidityMetadataContract.getGlobalIpfsGateway();
```

### Logging Configuration

You can set the global log level and provide a custom logger:

```typescript
import { setLibSourcifyLoggerLevel, setLibSourcifyLogger, getLibSourcifyLoggerLevel } from '@ethereum-sourcify/lib-sourcify';

// Set the log level
setLibSourcifyLoggerLevel(5); // 0=errors, 1=warnings, 2=info, 5=debug, 6=silly

// Get the current log level
const logLevel = getLibSourcifyLoggerLevel();

// Use a custom logger
setLibSourcifyLogger({
  logLevel: 2,
  setLevel(level: number) {
    this.logLevel = level;
  },
  log(level, msg) {
    // Custom logging implementation
  }
});
```

## Compiler Setup

The `lib-sourcify` library does not come with compilers as dependencies. Instead, you need to provide a class that implements either the `ISolidityCompiler` or `IVyperCompiler` interface and pass it to any function that requires a compiler. We suggest you to use the official [`@ethereum-sourcify/compilers`](https://github.com/ethereum/sourcify/tree/staging/packages/compilers) package.

In the case of an error in the `compile` function, `lib-sourcify` expects the thrown error to have a public `errors` property containing the compilation output's `errors` property.

### Solidity Compiler Example

```typescript
import {
  SolidityOutput,
  ISolidityCompiler,
  SolidityJsonInput,
} from "@ethereum-sourcify/lib-sourcify";
import { useSolidityCompiler } from "@ethereum-sourcify/compilers";

class Solc implements ISolidityCompiler {
  constructor(private solcRepoPath: string, private solJsonRepoPath: string) {}

  async compile(
    version: string,
    solcJsonInput: SolidityJsonInput,
    forceEmscripten: boolean = false
  ): Promise<SolidityOutput> {
    return await useSolidityCompiler(
      this.solcRepoPath,
      this.solJsonRepoPath,
      version,
      solcJsonInput,
      forceEmscripten
    );
  }
}

const solc = new Solc("/path/to/solc/repo", "/path/to/solcjs/repo");
```

### Vyper Compiler Example

```typescript
import { useVyperCompiler } from '@ethereum-sourcify/compilers';

import {
  IVyperCompiler,
  VyperOutput,
  VyperJsonInput,
} from '@ethereum-sourcify/lib-sourcify';

class Vyper implements IVyperCompiler {
  constructor(private vyperRepoPath: string) {}

  async compile(
    version: string,
    vyperJsonInput: VyperJsonInput,
  ): Promise<VyperOutput> {
    return await useVyperCompiler(this.vyperRepoPath, version, vyperJsonInput);
  }
}
const vyper = new Vyper('/path/to/vyper/repo');
```

## SourcifyChain

SourcifyChain is a class that handles blockchain interactions such as fetching bytecode and transaction data.

It supports HTTP header authenticated RPCs through ethers.js `FetchRequest` objects.

Also supports RPCs with `debug_traceTransaction` and `trace_call` methods to be able to fetch creation bytecode for factory contracts.

### Creating a SourcifyChain Instance

```typescript
import { SourcifyChain } from '@ethereum-sourcify/lib-sourcify';
import { FetchRequest } from 'ethers';

// Create a SourcifyChain for Ethereum Mainnet
const mainnetChain = new SourcifyChain({
  name: 'Ethereum Mainnet',
  chainId: 1,
  rpc: [
    'https://eth.llamarpc.com',
    new FetchRequest({
      url: 'https://authenticated-rpc.com',
      headers: {
        Authorization: 'Bearer ...',
      },
    }),
    'https://eth-mainnet.g.alchemy.com/v2/MY_API_KEY',
  ],
  traceSupportedRPCs: [
    {
      type: 'trace_transaction', // or 'debug_traceTransaction'
      index: 2, // index of the RPC in the rpc array
    },
  ],
  supported: true,
});
```

### Using Authenticated RPCs

For RPCs that require authentication, you can specify the headers directly in the configuration:

```typescript
import { SourcifyChain } from '@ethereum-sourcify/lib-sourcify';

const authenticatedChain = new SourcifyChain({
  name: 'Protected Network',
  chainId: 1234,
  rpc: [
    {
      type: 'FetchRequest',
      url: 'https://protected-rpc.example.com',
      headers: [
        {
          headerName: 'Authorization',
          headerValue: 'Bearer my-auth-token',
        },
        {
          headerName: 'X-API-Key',
          headerValue: 'my-api-key',
        },
      ],
    },
  ],
  supported: true,
});
```

## Validation

Note: Vyper contracts do not support validation through metadata files since they do not include a metadata JSON field in their bytecode. Instead, Vyper contracts must be verified directly using their source files and compiler settings.

### Validating Solidity Contracts with Metadata

v2 introduces the `SolidityMetadataContract` class which manages the validation workflow:

```typescript
import { SolidityMetadataContract } from '@ethereum-sourcify/lib-sourcify';

// Create a SolidityMetadataContract with metadata and sources
const metadataContract = new SolidityMetadataContract(metadata, sources);

// Create a compilation object that can be used for verification
const compilation = await metadataContract.createCompilation(solidityCompiler);
```

For file-based validation:

```typescript
import { createMetadataContractsFromFiles, PathBuffer } from '@ethereum-sourcify/lib-sourcify';

const pathBuffers: PathBuffer[] = [];
pathBuffers.push({
  path: filePath,
  buffer: fs.readFileSync(filePath),
});

// Create SolidityMetadataContract objects from files
const metadataContracts = await createMetadataContractsFromFiles(pathBuffers);

// Create compilation objects
for (const contract of metadataContracts) {
  const compilation = await contract.createCompilation(solidityCompiler);
  // Use compilation for verification
}
```

### Fetching Missing Sources

Each contract source either has a `content` field containing the Solidity code as a string, or URLs to fetch the sources from (Github, IPFS, Swarm etc.). If sources are missing, you can fetch them:

```typescript
// Fetch missing sources
await metadataContract.fetchMissing();
```

IPFS resources will be fetched using the configured IPFS gateway. You can configure the gateway using the `SolidityMetadataContract.setGlobalIpfsGateway()` method as shown in the Global Configuration section.

You can check if a contract is ready to be compiled with:

```typescript
const isCompilable = metadataContract.isCompilable(); // true or false
```

## Verification

In v2, the verification process is handled by the `Verification` class:

```typescript
import { Verification, SourcifyChain } from '@ethereum-sourcify/lib-sourcify';

// Set up the SourcifyChain
const chain = new SourcifyChain({
  name: 'Ethereum Mainnet',
  chainId: 1,
  rpc: ['https://eth.llamarpc.com'],
  supported: true,
});

// Create a verification instance
const verification = new Verification(
  compilation,
  chain,
  contractAddress,
  creatorTxHash, // optional, for creation bytecode verification
);

// Perform verification
await verification.verify();

// Check verification status
console.log(verification.status.runtimeMatch); // 'perfect', 'partial', or null
```

### Transformations

Sourcify adopts the [Verifier Alliance](https://verifieralliance.org) format called "transformations" to describe the changes from the compiled bytecode to onchain bytecode for a verification.

E.g. while immutable variables are set to `0x00..00` after compilation, they are set to the actual value in the onchain bytecode.

Refer to [VerA Docs](https://github.com/verifier-alliance/database-specs/tree/master/json-schemas) for more information.

## Error Handling

During verification, various errors can occur. In lib-sourcify v2, errors related to verification are thrown as `VerificationError` instances, which extend the `SourcifyLibError` class. These errors include a message and an error code that can be used to handle different error cases.

### Error Codes

See `VerificationErrorCode` type in [VerificationTypes.ts](./src/Verification/VerificationTypes.ts#L14-L23) for the full list of error codes.

## Logging

`lib-sourcify` has a basic logging system that can be configured globally.

You can specify the log level using the `setLibSourcifyLoggerLevel(level)` function where:

- `0` is errors
- `1` is warnings
- `2` is infos
- `5` is debug
- `6` is silly

You can get the current log level using `getLibSourcifyLoggerLevel()`.

You can override the logger by calling `setLogger(logger: ILibSourcifyLogger)`:

```javascript
const winston = require('winston');
const myCustomLogger = winston.createLogger({
  // ...
});

setLibSourcifyLogger({
  logLevel: 2, // What levels to log. E.g. Log anything lower than info: error and warning
  setLevel(level: number) {
    this.logLevel = level;
  },
  log(level, msg) {
    if (level <= this.logLevel) {
      switch (level) {
        case 0:
          myCustomLogger.error(msg);
          break;
        case 1:
          myCustomLogger.warn(msg);
          break;
        case 2:
          myCustomLogger.info(msg);
          break;
        case 5:
          myCustomLogger.debug(msg);
          break;
      }
    }
  },
});
```

## Migration Guide from v1 to v2

Version 2 of lib-sourcify brings a significant redesign of the library's architecture. Here's how to migrate from v1 to v2:

### Key Changes

1. **Class Structure Changes**:

   - `AbstractCheckedContract` is replaced by language-specific compilation classes
   - `SolidityCheckedContract` functionality is now split between `SolidityMetadataContract` and `SolidityCompilation`
   - `VyperCheckedContract` is now represented by `VyperCompilation`
   - New `Verification` class handles the verification process

2. **Workflow Changes**:
   - Validation, compilation, and verification are now separate steps
   - More explicit control over the verification process

### Migration Examples

#### From v1: Using SolidityCheckedContract

```typescript
// V1 code
const checkedContracts = await checkFilesWithMetadata(solc, pathBuffers);
const solidityCheckedContract = checkedContracts[0];
await solidityCheckedContract.fetchMissing();
const match = await verifyDeployed(
  solidityCheckedContract,
  sourcifyChain,
  contractAddress,
);
```

#### To v2: Using SolidityMetadataContract and Verification

```typescript
// V2 code
import {
  createMetadataContractsFromFiles,
  Verification,
} from '@ethereum-sourcify/lib-sourcify';

// Create metadata contracts from files
const metadataContracts = await createMetadataContractsFromFiles(pathBuffers);
const metadataContract = metadataContracts[0];

// Fetch missing sources
await metadataContract.fetchMissing();

// Create compilation
const compilation = await metadataContract.createCompilation(solc);

// Create verification instance
const verification = new Verification(
  compilation,
  sourcifyChain,
  contractAddress,
);

// Perform verification
await verification.verify();

// Check verification status
const status = verification.status;
```

## Functions of v1 vs v2

| v1 Function/Class         | v2 Equivalent                                      |
| ------------------------- | -------------------------------------------------- |
| `SolidityCheckedContract` | `SolidityMetadataContract` + `SolidityCompilation` |
| `VyperCheckedContract`    | `VyperCompilation`                                 |
| `checkFilesWithMetadata`  | `createMetadataContractsFromFiles`                 |
| `verifyDeployed`          | `Verification.verify()`                            |
| `fetchMissing`            | `metadataContract.fetchMissing()`                  |
| `isValid`                 | `metadataContract.isCompilable()`                  |
