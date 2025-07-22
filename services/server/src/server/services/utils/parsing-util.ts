import { Sources } from "@ethereum-sourcify/lib-sourcify";
import logger from "../../../common/logger";
import SolidityParser from "@solidity-parser/parser";

/**
 * Returns undefined if the contract is not found in the sources
 */
export const getContractPathFromSources = (
  contractName: string,
  sources: Sources,
): string | undefined => {
  logger.debug("parsing-util: Parsing sources for finding the contract path", {
    contractName,
  });
  const startTime = Date.now();
  let contractPath: string | undefined;
  for (const [path, { content }] of Object.entries(sources)) {
    try {
      const ast = SolidityParser.parse(content);
      SolidityParser.visit(ast, {
        ContractDefinition: (node) => {
          if (node.name === contractName) {
            contractPath = path;
            return false; // Stop visiting
          }
        },
      });
    } catch (error) {
      // Just continue, because the relevant contract might be in a different source file.
      logger.warn(
        "parsing-util: Error parsing source code. Ignoring this source.",
        {
          path,
          error,
        },
      );
    }
  }
  const endTime = Date.now();
  logger.debug("parsing-util: Parsing for all sources done", {
    contractName,
    contractPath,
    timeInMs: endTime - startTime,
  });

  return contractPath;
};
