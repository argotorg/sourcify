import { Router } from "express"; // static is a reserved word
import logger, { setLogLevel } from "../common/logger";
import { ChainRepository } from "../sourcify-chain-repository";
import apiV2Routes from "./apiv2/routes";
import apiV1Routes from "./apiv1/routes";

const router: Router = Router();

router.get("/health", (_req, res) => {
  res.status(200).send("Alive and kicking!");
});

// Authenticated route to change the logging level.
// Authentication handled by the express-openapi-validator middleware
router.post("/private/change-log-level", (req, res) => {
  const { level } = req.body ?? {};
  try {
    setLogLevel(level);
    res.status(200).send(`Logging level changed to: ${level}`);
  } catch (error) {
    logger.error({
      message: "Failed to change logging level",
      error,
    });
    res.status(500).send("Failed to change logging level: " + error);
  }
});

router.get("/chains", (_req, res) => {
  const chainRepository = _req.app.get("chainRepository") as ChainRepository;
  const sourcifyChainsArray = chainRepository.sourcifyChainsArray;
  const sourcifyChains = sourcifyChainsArray.map(
    ({
      rpcWithoutApiKeys,
      name,
      title,
      chainId,
      supported,
      etherscanApi,
      traceSupportedRPCs,
    }) => {
      return {
        name,
        title,
        chainId,
        rpc: rpcWithoutApiKeys,
        traceSupportedRPCs,
        supported,
        etherscanAPI: etherscanApi?.supported ?? false, // Needed in the UI
      };
    },
  );

  res.status(200).json(sourcifyChains);
});

router.use("/", apiV1Routes);
router.use("/v2", apiV2Routes);

export default router;
