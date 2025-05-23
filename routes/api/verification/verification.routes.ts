import {
  validateAddress,
  validateChainId,
  validateContractIdentifier,
  checkIfAlreadyVerified,
  checkIfJobIsAlreadyRunning,
  validateStandardJsonInput,
} from "../middlewares";
import {
  verifyFromJsonInputEndpoint,
  verifyFromEtherscanEndpoint,
} from "./verification.handlers";
import { Router } from "express";

const router = Router();

router
  .route("/verify/:chainId/:address")
  .post(
    validateChainId,
    validateAddress,
    validateStandardJsonInput,
    validateContractIdentifier,
    checkIfAlreadyVerified,
    checkIfJobIsAlreadyRunning,
    verifyFromJsonInputEndpoint,
  );

router
  .route("/verify/etherscan/:chainId/:address")
  .post(
    validateChainId,
    validateAddress,
    checkIfAlreadyVerified,
    checkIfJobIsAlreadyRunning,
    verifyFromEtherscanEndpoint,
  );

export default router;
