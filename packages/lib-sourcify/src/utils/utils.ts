import type {
  Libraries,
  MetadataCompilerSettings,
} from '@ethereum-sourcify/compilers-types';

/**
 * Checks whether the provided object contains any keys or not.
 * @param obj The object whose emptiness is tested.
 * @returns true if any keys present; false otherwise
 */
export function isEmpty(obj: object): boolean {
  return !Object.keys(obj).length && obj.constructor === Object;
}

/**
 * Splits a fully qualified name into a contract path and a contract name.
 * @param fullyQualifiedName The fully qualified name to split.
 * @returns An object containing the contract path and the contract name.
 */
export function splitFullyQualifiedName(fullyQualifiedName: string): {
  contractPath: string;
  contractName: string;
} {
  const splitIdentifier = fullyQualifiedName.split(':');
  const contractName = splitIdentifier[splitIdentifier.length - 1];
  const contractPath = splitIdentifier.slice(0, -1).join(':');
  return { contractPath, contractName };
}

/**
 * Converts libraries from the solc JSON input format to the metadata format.
 * jsonInput format: { "contracts/1_Storage.sol": { Journal: "0x..." } }
 * metadata format: { "contracts/1_Storage.sol:Journal": "0x..." }
 */
export function convertLibrariesToMetadataFormat(
  libraries?: Libraries,
): MetadataCompilerSettings['libraries'] {
  if (!libraries) {
    return undefined;
  }

  const metadataLibraries: NonNullable<MetadataCompilerSettings['libraries']> =
    {};

  for (const [contractPath, libraryMap] of Object.entries(libraries)) {
    for (const [libraryName, libraryAddress] of Object.entries(libraryMap)) {
      const metadataKey =
        contractPath === '' ? libraryName : `${contractPath}:${libraryName}`;
      metadataLibraries[metadataKey] = libraryAddress;
    }
  }

  return Object.keys(metadataLibraries).length ? metadataLibraries : undefined;
}

/**
 * Converts libraries from the metadata format to the solc JSON input format.
 * metadata format: { "contracts/1_Storage.sol:Journal": "0x..." }
 * jsonInput format: { "contracts/1_Storage.sol": { Journal: "0x..." } }
 */
export function convertLibrariesToStdJsonFormat(
  metadataLibraries?: MetadataCompilerSettings['libraries'],
): Libraries | undefined {
  if (!metadataLibraries) {
    return undefined;
  }

  return Object.keys(metadataLibraries).reduce((libraries, libraryKey) => {
    // Before Solidity v0.7.5: { "ERC20": "0x..."}
    if (!libraryKey.includes(':')) {
      if (!libraries['']) {
        libraries[''] = {};
      }
      // try using the global method, available for pre 0.7.5 versions
      libraries[''][libraryKey] = metadataLibraries[libraryKey];
      return libraries;
    }

    // After Solidity v0.7.5: { "ERC20.sol:ERC20": "0x..."}
    const { contractPath, contractName } = splitFullyQualifiedName(libraryKey);
    if (!libraries[contractPath]) {
      libraries[contractPath] = {};
    }
    libraries[contractPath][contractName] = metadataLibraries[libraryKey];
    return libraries;
  }, {} as Libraries);
}
