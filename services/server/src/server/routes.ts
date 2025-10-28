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
    ({ rpcs, name, title, chainId, supported, etherscanApi }) => {
      return {
        name,
        title,
        chainId,
        rpc: rpcs
          .map((r) => r.urlWithoutApiKey)
          .filter((url) => url !== undefined),
        traceSupportedRPCs: rpcs
          .map((r, index) =>
            r.traceSupport ? { type: r.traceSupport, index } : null,
          )
          .filter((r) => r !== null),
        supported,
        etherscanAPI: etherscanApi?.supported ?? false, // Needed in the UI
      };
    },
  );

  res.status(200).json(sourcifyChains);
});

router.get("/verify-ui/*path", (req, res, next) => {
  const sourcifyVerifyUi = req.app.get("sourcifyVerifyUi") as
    | string
    | undefined;
  if (sourcifyVerifyUi) {
    const pathAfterVerify = req.path.substring("/verify-ui".length);
    const redirectUrl = `${sourcifyVerifyUi}${pathAfterVerify}`;
    return res.redirect(redirectUrl);
  }
  // Fallback to API redirect
  if (req.path.includes("/jobs")) {
    let pathAfterVerify = req.path.substring("/verify-ui".length);
    pathAfterVerify = pathAfterVerify.replace("/jobs", "");
    const redirectUrl = `/v2/verify${pathAfterVerify}`;
    return res.redirect(redirectUrl);
  }
  next();
});

router.get("/repo-ui/*path", (req, res) => {
  const sourcifyRepoUi = req.app.get("sourcifyRepoUi") as string | undefined;
  if (sourcifyRepoUi) {
    const pathAfterContract = req.path.substring("/repo-ui".length);
    const redirectUrl = `${sourcifyRepoUi}${pathAfterContract}`;
    return res.redirect(redirectUrl);
  }
  // Fallback to API redirect
  const pathAfterContract = req.path.substring("/repo-ui".length);
  const redirectUrl = `/v2/contract${pathAfterContract}`;
  return res.redirect(redirectUrl);
});

router.use("/", apiV1Routes);
router.use("/v2", apiV2Routes);
export default router;
