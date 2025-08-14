import SolidityParser from '@solidity-parser/parser';
import { Sources } from '..';
import { logDebug, logWarn } from '../logger';

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
 * Returns undefined if the contract is not found in the sources
 */
export const getContractPathFromSources = (
  contractName: string,
  sources: Sources,
): string | undefined => {
  logDebug('parsing-util: Parsing sources for finding the contract path', {
    contractName,
  });
  const startTime = Date.now();
  let contractPath: string | undefined;
  for (const [path, { content }] of Object.entries(sources)) {
    try {
      const ast = SolidityParser.parse(content);
      SolidityParser.visit(ast, {
        ContractDefinition: (node: any): any => {
          if (node.name === contractName) {
            contractPath = path;
            return false; // Stop visiting
          }
          return undefined;
        },
      });
      if (contractPath) break;
    } catch (error) {
      // Just continue, because the relevant contract might be in a different source file.
      logWarn(
        'parsing-util: Error parsing source code. Ignoring this source.',
        {
          path,
          error,
        },
      );
    }
  }
  const endTime = Date.now();
  logDebug('parsing-util: Parsing for all sources done', {
    contractName,
    contractPath,
    timeInMs: endTime - startTime,
  });

  return contractPath;
};
