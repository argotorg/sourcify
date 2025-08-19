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
