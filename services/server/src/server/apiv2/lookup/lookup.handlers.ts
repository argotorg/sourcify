import { StatusCodes } from "http-status-codes";
import { Services } from "../../services/services";
import logger from "../../../common/logger";
import { Request } from "express";
import {
  ProxyResolution,
  TypedResponse,
  VerifiedContract,
  VerifiedContractMinimal,
} from "../../types";
import { getAddress } from "ethers";
import {
  detectAndResolveProxy,
  Implementation,
} from "../../services/utils/proxy-contract-util";
import { ChainRepository } from "../../../sourcify-chain-repository";
import { v4 as uuidv4 } from "uuid";
import { Field } from "../../services/utils/database-util";

interface ListContractsRequest extends Request {
  params: {
    chainId: string;
  };
  query: {
    limit?: string;
    sort?: string;
    afterMatchId?: string;
  };
}

type ListContractsResponse = TypedResponse<{
  results: VerifiedContractMinimal[];
}>;

export async function listContractsEndpoint(
  req: ListContractsRequest,
  res: ListContractsResponse,
) {
  logger.debug("listContractsEndpoint", {
    chainId: req.params.chainId,
    limit: req.query.limit,
    sort: req.query.sort,
    afterMatchId: req.query.afterMatchId,
  });
  const services = req.app.get("services") as Services;

  const resultsObject = await services.storage.performServiceOperation(
    "getContractsByChainId",
    [
      req.params.chainId,
      parseInt(req.query.limit || "200"),
      req.query.sort === "desc" || !req.query.sort,
      req.query.afterMatchId,
    ],
  );

  res.status(StatusCodes.OK).json(resultsObject);
}

interface GetContractRequest extends Request {
  params: {
    chainId: string;
    address: string;
  };
  query: {
    fields?: string;
    omit?: string;
  };
}

type GetContractResponse = TypedResponse<VerifiedContract>;

export async function getContractEndpoint(
  req: GetContractRequest,
  res: GetContractResponse,
) {
  logger.debug("getContractEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    fields: req.query.fields,
    omit: req.query.omit,
  });
  const services = req.app.get("services") as Services;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  const fields = req.query.fields?.split(",") as Field[];
  const omit = req.query.omit?.split(",") as Field[];

  const contract = await services.storage.performServiceOperation(
    "getContract",
    [req.params.chainId, req.params.address, fields, omit],
  );

  if (!contract.match) {
    res.status(StatusCodes.NOT_FOUND).json(contract);
    return;
  }

  // TODO:
  // The proxy detection will be integrated into the verification process,
  // and the proxy detection result will be stored in the database.
  // When we have this, we will only need to resolve the implementation address here,
  // and don't need to query the onchain runtime bytecode.
  if (
    (fields && fields.includes("proxyResolution")) ||
    (omit && !omit.includes("proxyResolution"))
  ) {
    let proxyResolution: ProxyResolution;

    try {
      const sourcifyChain =
        chainRepository.supportedChainMap[req.params.chainId];
      const proxyDetectionResult = await detectAndResolveProxy(
        contract.proxyResolution!.onchainCreationBytecode ||
          contract.proxyResolution!.onchainRuntimeBytecode!,
        req.params.address,
        sourcifyChain,
      );

      const implementations = await Promise.all(
        proxyDetectionResult.implementations.map(
          async ({ address: implementationAddress }) => {
            implementationAddress = getAddress(implementationAddress);
            const implementation: Implementation = {
              address: implementationAddress,
            };

            const implementationContract =
              await services.storage.performServiceOperation("getContract", [
                req.params.chainId,
                implementationAddress,
                ["compilation.name"],
                undefined,
              ]);
            if (implementationContract.compilation?.name) {
              implementation.name = implementationContract.compilation.name;
            }
            return implementation;
          },
        ),
      );

      proxyResolution = { ...proxyDetectionResult, implementations };
    } catch (error) {
      proxyResolution = {
        proxyResolutionError: {
          customCode: "proxy_resolution_error",
          message:
            "Error while running proxy detection and implementation resolution",
          errorId: uuidv4(),
        },
      };
      logger.error("Error detecting and resolving proxy", {
        chainId: req.params.chainId,
        address: req.params.address,
        error,
      });
    }

    contract.proxyResolution = proxyResolution;
  }

  res.status(StatusCodes.OK).json(contract);
}

interface GetContractAllChainsRequest extends Request {
  params: {
    address: string;
  };
}

type GetContractAllChainsResponse = TypedResponse<{
  results: VerifiedContractMinimal[];
}>;

export async function getContractAllChainsEndpoint(
  req: GetContractAllChainsRequest,
  res: GetContractAllChainsResponse,
) {
  logger.debug("getContractAllChainsEndpoint", {
    address: req.params.address,
  });
  const services = req.app.get("services") as Services;
  const resultsObject = await services.storage.performServiceOperation(
    "getContractsAllChains",
    [req.params.address],
  );

  if (resultsObject.results.length === 0) {
    res.status(StatusCodes.NOT_FOUND).json(resultsObject);
    return;
  }

  res.status(StatusCodes.OK).json(resultsObject);
}
