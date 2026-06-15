# bytecode-utils

Decode the [CBOR encoded data](https://docs.soliditylang.org/en/latest/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode) at the end of an Ethereum contract's bytecode.

## Install

```
yarn add @ethereum-sourcify/bytecode-utils
```

## Usage

### Solidity Contracts

```ts
import { decode, AuxdataStyle } from "@ethereum-sourcify/bytecode-utils";

const bytecodeRaw = "0x60806040526004361061003f5760003560e01...7265206c656e677468a2646970667358221220dceca8706b29e917dacf25fceef95acac8d90d765ac926663ce4096195952b6164736f6c634300060b0033"

// For Solidity contracts
decode(bytecodeRaw, AuxdataStyle.SOLIDITY);
```

**Result example**

```json
{
  "ipfs": "QmdD3hpMj6mEFVy9DP4QqjHaoeYbhKsYvApX1YZNfjTVWp",
  "solcVersion": "0.6.11",
  "experimental": true,
  "bzzr0": "...",
  "bzzr1": "..."
}
```

### Vyper Contracts

```ts
import { decode, getAuxdataStyle } from "@ethereum-sourcify/bytecode-utils";

const vyperBytecodeRaw = "0x..."; // Your Vyper contract bytecode

// For Vyper contracts
decode(vyperBytecodeRaw, getAuxdataStyle("Vyper", "0.4.1"));
```

**Result example**

```json
{
  "integrity": "...",
  "runtimeSize": 1234,
  "dataSizes": [32, 64, 128],
  "immutableSize": 256,
  "vyperVersion": "0.3.10"
}
```

#### Vyper Version Compatibility Notes

Different Vyper compiler versions use different auxdata formats:

- `<0.3.4`: no CBOR auxdata
- `0.3.4`: CBOR map `{"vyper": [0, 3, 4]}` with no length footer
- `0.3.5-0.3.9`: CBOR map `{"vyper": [...]}` plus length footer
- `0.3.10-0.4.0`: CBOR array `[runtimeSize, dataSizes, immutableSize, {"vyper": [...]}]`
- `>=0.4.1`: CBOR array `[integrity, runtimeSize, dataSizes, immutableSize, {"vyper": [...]}]`
