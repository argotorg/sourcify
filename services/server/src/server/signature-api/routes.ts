import { Router } from "express";
import {
  lookupSignatures,
  searchSignatures,
  getSignaturesStats,
} from "./openchain.handlers";
import { RWStorageIdentifiers } from "../services/storageServices/identifiers";
import { Services } from "../services/services";
import {
  sendSignatureApiFailure,
  validateHashQueries,
  validateSearchQuery,
} from "./openchain.validation";

const router = Router();

router.use((req, res, next) => {
  const services = req.app.get("services") as Services;
  if (
    services.storage.enabledServices.read !==
    RWStorageIdentifiers.SourcifyDatabase
  ) {
    sendSignatureApiFailure(
      res,
      "Signature API is disabled because the server has no database configured as read service.",
    );
    return;
  }
  next();
});

// Routes to mimic the OpenChain API: https://github.com/openchainxyz/openchain-monorepo
router.route("/v1/lookup").get(validateHashQueries, lookupSignatures);
router.route("/v1/search").get(validateSearchQuery, searchSignatures);
router.route("/v1/stats").get(getSignaturesStats);

export default router;
