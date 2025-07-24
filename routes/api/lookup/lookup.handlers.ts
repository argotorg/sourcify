import { StatusCodes } from "http-status-codes";
import { Services } from "../../../services/services";
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
} from "../../../services/utils/proxy-contract-util";
import { v4 as uuidv4 } from "uuid";
import { Field } from "../../../services/store/Tables";
import { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify/build/main/SourcifyChain/SourcifyChainTypes";
import { getChainId } from "../errors";

interface ListContractsRequest extends Request {
  params: {
    chainId: string;
  };
  query: {
    limit?: string;
    sort?: string;
    afterMatchId?: string;
    addresses?: string;
  };
}

type ListContractsResponse = TypedResponse<{
  results: VerifiedContractMinimal[];
}>;

export async function listContractsEndpoint(
  req: ListContractsRequest,
  res: ListContractsResponse,
) {
  /*console.debug("listContractsEndpoint", {
    chainId: req.params.chainId,
    limit: req.query.limit,
    sort: req.query.sort,
    afterMatchId: req.query.afterMatchId,
    addresses: req.query.addresses,
  });*/
  const services = req.app.get("services") as Services;
  const chain = getChainId(req.params.chainId)
  const addresses = req.query?.addresses?.split(",");

  const contracts = await services.store.getContractsByChainId(
    chain,
    parseInt(req.query.limit || "200"),
    req.query.sort === "desc" || !req.query.sort,
    req.query.afterMatchId,
    addresses)

  res.status(StatusCodes.OK).json(contracts);
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
  /*console.debug("getContractEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    fields: req.query.fields,
    omit: req.query.omit,
  });*/
  const services = req.app.get("services") as Services;
  const sourcifyChainMap = req.app.get("chains") as SourcifyChainMap

  const fields = req.query.fields?.split(",") as Field[];
  const omit = req.query.omit?.split(",") as Field[];
  const chain = getChainId(req.params.chainId)

  const contract = await services.store.getContract(chain, req.params.address, fields, omit)

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
      const sourcifyChain = sourcifyChainMap[req.params.chainId];
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
            const chain = getChainId(req.params.chainId)

            const implementationContract = await services.store.getContract(
              chain,
              implementationAddress,
              ["compilation.name"],
              undefined
            )
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
      console.error("Error detecting and resolving proxy", {
        chainId: req.params.chainId,
        address: req.params.address,
        error,
      });
    }

    contract.proxyResolution = proxyResolution;
  }

  res.status(StatusCodes.OK).json(contract);
}
