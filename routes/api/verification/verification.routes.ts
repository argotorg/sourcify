import {
  validateAddress,
  validateChainId,
  validateContractIdentifier,
  checkIfAlreadyVerified,
  checkIfJobIsAlreadyRunning,
  validateStandardJsonInput,
  validateMetadata,
  validateCompilerVersion,
  validateSources,
} from "../middlewares";
import {
  verifyFromConfluxscanEndpoint,
  verifyFromCrossChainEndpoint,
  verifyFromJsonInputEndpoint,
  verifyFromMetadataEndpoint,
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
    validateCompilerVersion,
    checkIfAlreadyVerified,
    checkIfJobIsAlreadyRunning,
    verifyFromJsonInputEndpoint,
  );

router
  .route("/verify/metadata/:chainId/:address")
  .post(
    validateChainId,
    validateAddress,
    validateMetadata,
    validateSources,
    checkIfAlreadyVerified,
    checkIfJobIsAlreadyRunning,
    verifyFromMetadataEndpoint,
  );

router
  .route("/verify/confluxscan/:chainId/:address")
  .post(
    validateChainId,
    validateAddress,
    checkIfAlreadyVerified,
    checkIfJobIsAlreadyRunning,
    verifyFromConfluxscanEndpoint,
  );

router
  .route("/verify/crosschain/:chainId/:address")
  .post(
    validateChainId,
    validateAddress,
    checkIfAlreadyVerified,
    checkIfJobIsAlreadyRunning,
    verifyFromCrossChainEndpoint,
  );

export default router;
