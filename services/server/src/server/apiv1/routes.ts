import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import testArtifactsRoutes from "./testartifacts/testartifacts.routes";
import repositoryRoutes from "./repository/repository.routes";
import verifyRoutes from "./verification/verify/verify.routes";
import solcJsonRoutes from "./verification/solc-json/solc-json.routes";
import etherscanRoutes from "./verification/etherscan/etherscan.routes";
import vyperRoutes from "./verification/vyper/vyper.routes";
import { checksumAddresses } from "./controllers.common";
import privateRoutes from "./verification/private/private.routes";

const router: Router = Router();

// checksum addresses in every request
router.use(checksumAddresses);

router.use("/chain-tests", testArtifactsRoutes);

// Add deprecation header to all API v1 responses
router.use(
  [
    "/verify",
    "/repository",
    "/check-all-by-addresses",
    "/check-by-addresses",
    "/files",
  ],
  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Deprecation", "true");
    res.setHeader(
      "Warning",
      '299 - "Deprecated: use v2 API. See https://sourcify.dev/server/api-docs/swagger.json"',
    );
    next();
  },
);

router.use("/", repositoryRoutes);
router.use("/", verifyRoutes);
router.use("/", solcJsonRoutes);
router.use("/", etherscanRoutes);
router.use("/", vyperRoutes);
router.use("/", privateRoutes);

export default router;
