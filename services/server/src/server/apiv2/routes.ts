import { Router } from "express";
import lookupRoutes from "./lookup/lookup.routes";
import jobsRoutes from "./jobs/jobs.routes";
import verificationRoutes from "./verification/verification.routes";
import { Services } from "../services/services";
import { RWStorageIdentifiers } from "../services/storageServices/identifiers";
import { RouteNotFoundError } from "./errors";

const router: Router = Router();

router.use((req, res, next) => {
  const services = req.app.get("services") as Services;
  if (
    services.storage.enabledServices.read !==
    RWStorageIdentifiers.SourcifyDatabase
  ) {
    throw new RouteNotFoundError(
      "API v2 is disabled because the server has no database configured as read service.",
    );
  }
  next();
});

router.use("/", lookupRoutes);
router.use("/", jobsRoutes);
router.use("/", verificationRoutes);

export default router;
