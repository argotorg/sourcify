import {
  validateAddress,
  validateChainId,
  validateFieldsAndOmit,
} from "../middlewares";
import {
  getContractAllChainsEndpoint,
  getContractEndpoint,
  listContractsEndpoint,
} from "./lookup.handlers";

import { Router } from "express";

const router = Router();

router
  .route("/contract/all-chains/:address")
  .get(validateAddress, getContractAllChainsEndpoint);

router.route("/contracts/:chainId").get(validateChainId, listContractsEndpoint);

router
  .route("/contract/:chainId/:address")
  .get(
    validateChainId,
    validateAddress,
    validateFieldsAndOmit,
    getContractEndpoint,
  );

export default router;
