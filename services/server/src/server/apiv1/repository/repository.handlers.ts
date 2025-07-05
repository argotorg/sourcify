import { Response, Request, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import {
  ContractData,
  FilesInfo,
  V1MatchLevel,
  V1MatchLevelWithoutAny,
  PaginatedData,
  Match,
} from "../../types";
import { NotFoundError } from "../../../common/errors";
import logger from "../../../common/logger";
import { Services } from "../../services/services";
import {
  detectAndResolveProxy,
  Implementation,
  ProxyDetectionResult,
} from "../../services/utils/proxy-contract-util";
import { ChainRepository } from "../../../sourcify-chain-repository";
import { getAddress } from "ethers";
import path from "path";

type RetrieveMethod = (
  services: Services,
  chain: string,
  address: string,
  match: V1MatchLevel,
) => Promise<FilesInfo<any>>;
type ConractRetrieveMethod = (
  services: Services,
  chain: string,
) => Promise<ContractData>;
type PaginatedConractRetrieveMethod = (
  services: Services,
  chain: string,
  match: V1MatchLevel,
  page: number,
  limit: number,
  descending: boolean,
) => Promise<PaginatedData<string>>;

export function createEndpoint(
  retrieveMethod: RetrieveMethod,
  match: V1MatchLevel,
  reportMatchStatus = false,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const services = req.app.get("services") as Services;
    let retrieved: FilesInfo<any>;
    try {
      retrieved = await retrieveMethod(
        services,
        req.params.chain,
        req.params.address,
        match,
      );
      if (retrieved.files.length === 0)
        return next(new NotFoundError("Files have not been found!"));
    } catch (err: any) {
      return next(new NotFoundError(err.message));
    }
    res
      .status(StatusCodes.OK)
      .json(reportMatchStatus ? retrieved : retrieved.files);
  };
}

export function createContractEndpoint(
  contractRetrieveMethod: ConractRetrieveMethod,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const services = req.app.get("services") as Services;
    let retrieved: ContractData;
    try {
      retrieved = await contractRetrieveMethod(services, req.params.chain);
      if (retrieved.full.length === 0 && retrieved.partial.length === 0)
        return next(new NotFoundError("Contracts have not been found!"));
    } catch (err: any) {
      return next(new NotFoundError(err.message));
    }
    res.status(StatusCodes.OK).json(retrieved);
  };
}

export function createPaginatedContractEndpoint(
  paginatedContractRetrieveMethod: PaginatedConractRetrieveMethod,
  match: V1MatchLevel,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const services = req.app.get("services") as Services;
    let retrieved: PaginatedData<string>;
    try {
      retrieved = await paginatedContractRetrieveMethod(
        services,
        req.params.chain,
        match,
        parseInt((req.query.page as string) || "0"),
        parseInt((req.query.limit as string) || "200"),
        req.query.order === "desc", // default is asc
      );
    } catch (err: any) {
      return next(new NotFoundError(err.message));
    }
    res.status(StatusCodes.OK).json(retrieved);
  };
}

export interface CheckAllByChainAndAddressEndpointRequest extends Request {
  query: {
    addresses: string;
    chainIds: string;
    resolveProxies: string;
  };
}

export async function checkAllByChainAndAddressEndpoint(
  req: CheckAllByChainAndAddressEndpointRequest,
  res: Response,
) {
  const services = req.app.get("services") as Services;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;
  const map: Map<string, any> = new Map();
  const addresses = req.query.addresses.split(",");
  const chainIds = req.query.chainIds?.split?.(",");
  logger.debug("checkAllByChainAndAddresses", { chainIds, addresses });
  for (const address of addresses) {
    for (const chainId of chainIds) {
      try {
        const found: Match[] = await services.storage.performServiceOperation(
          "checkAllByChainAndAddress",
          [address, chainId],
        );
        if (found.length != 0) {
          if (!map.has(address)) {
            map.set(address, {
              address,
              chainIds: [],
            });
          }

          // Proxy detection and resolution
          let proxyStatus: Partial<ProxyDetectionResult> & {
            proxyResolutionError?: string;
          } = {};
          if (
            req.query.resolveProxies === "true" &&
            found[0].onchainRuntimeBytecode
          ) {
            try {
              const sourcifyChain = chainRepository.supportedChainMap[chainId];
              const proxyDetectionResult = await detectAndResolveProxy(
                found[0].onchainRuntimeBytecode,
                address,
                sourcifyChain,
              );

              // Find contract names if the implementations are verified on Sourcify
              const implementations = await Promise.all(
                proxyDetectionResult.implementations.map(
                  async ({ address: implementationAddress }) => {
                    implementationAddress = getAddress(implementationAddress);
                    const implementation: Implementation = {
                      address: implementationAddress,
                    };

                    const implementationFound: Match[] =
                      await services.storage.performServiceOperation(
                        "checkAllByChainAndAddress",
                        [implementationAddress, chainId],
                      );
                    if (
                      implementationFound.length > 0 &&
                      implementationFound[0].contractName
                    ) {
                      implementation.name = implementationFound[0].contractName;
                    }
                    return implementation;
                  },
                ),
              );

              proxyStatus = { ...proxyDetectionResult, implementations };
              logger.debug("Ran proxy detection and resolution", {
                chainId,
                address,
                proxyStatus,
              });
            } catch (error) {
              proxyStatus.proxyResolutionError = (error as Error)?.message;
              logger.error("Error detecting and resolving proxy", {
                chainId,
                address,
                error,
              });
            }
          }

          map.get(address).chainIds.push({
            chainId,
            status: found[0].runtimeMatch,
            ...proxyStatus,
          });
        }
      } catch (error) {
        // This should only be triggered if performServiceOperation fails
        // The address for this chainId will be ignored
        logger.warn("Error during checkAllByChainAndAddresses", {
          chainId,
          address,
          error,
        });
      }
    }
    if (!map.has(address)) {
      map.set(address, {
        address: address,
        status: "false",
      });
    }
  }
  const resultArray = Array.from(map.values());
  logger.debug("Result checkAllByChainAndAddresses", { resultArray });
  res.send(resultArray);
}

function jsonOrString(str: string): object | string {
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}

export async function getFileEndpoint(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { match, chain, address, filePath } = req.params;
  const services = req.app.get("services") as Services;
  const file = await services.storage.performServiceOperation("getFile", [
    chain,
    address,
    match as V1MatchLevelWithoutAny,
    path.join(...filePath),
  ]);
  if (file === false) {
    return next(new NotFoundError());
  }
  res.send(jsonOrString(file));
}

export async function checkByChainAndAddressesEnpoint(
  req: Request,
  res: Response,
) {
  const services = req.app.get("services") as Services;
  const map: Map<string, any> = new Map();
  const addresses = (req.query.addresses as string).split(",");
  const chainIds = (req.query.chainIds as string).split(",");
  logger.debug("checkByChainAndAddresses", { chainIds, addresses });
  for (const address of addresses) {
    for (const chainId of chainIds) {
      try {
        const found: Match[] = await services.storage.performServiceOperation(
          "checkByChainAndAddress",
          [address, chainId],
        );
        if (found.length != 0) {
          if (!map.has(address)) {
            map.set(address, { address, status: "perfect", chainIds: [] });
          }

          map.get(address).chainIds.push(chainId);
        }
      } catch (error) {
        // ignore
      }
    }
    if (!map.has(address)) {
      map.set(address, {
        address: address,
        status: "false",
      });
    }
  }
  const resultArray = Array.from(map.values());
  logger.debug("Result checkByChainAndAddresses", { resultArray });
  res.send(resultArray);
}
