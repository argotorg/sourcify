import { Router, Request, Response, NextFunction } from "express";
import testArtifactsRoutes from "./testartifacts/testartifacts.routes";
import repositoryRoutes from "./repository/repository.routes";
import sessionStateRoutes from "./verification/session-state/session-state.routes";
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
    "/session",
  ],
  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Deprecation", "true");
    next();
  },
);

router.use("/", repositoryRoutes);
router.use("/", sessionStateRoutes);
router.use("/", verifyRoutes);
router.use("/", solcJsonRoutes);
router.use("/", etherscanRoutes);
router.use("/", vyperRoutes);
router.use("/", privateRoutes);

export default router;
