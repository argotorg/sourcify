import { Router, Request, Response, NextFunction } from "express";
import logger, { setLogLevel } from "../common/logger";
import { ChainRepository } from "../sourcify-chain-repository";
import apiV2Routes from "./apiv2/routes";
import apiV1Routes from "./apiv1/routes";
import { readFileSync } from "fs";
import { join } from "path";
import packageJson from "../../package.json";

const router: Router = Router();

router.get("/health", (_req, res) => {
  res.status(200).send("Alive and kicking!");
});

router.get("/version", (_req, res) => {
  let gitCommitHash = "unknown";
  try {
    gitCommitHash = readFileSync(
      join(__dirname, "../git-commit-hash.txt"),
      "utf-8",
    ).trim();
  } catch (error) {
    logger.warn({
      message: "Failed to read git commit hash",
      error,
    });
  }

  res.status(200).json({
    sourcifyServerVersion: packageJson.version,
    libSourcifyVersion:
      packageJson.dependencies["@ethereum-sourcify/lib-sourcify"],
    sourcifyCompilersVersion:
      packageJson.dependencies["@ethereum-sourcify/compilers"],
    bytecodeUtilsVersion:
      packageJson.dependencies["@ethereum-sourcify/bytecode-utils"],
    gitCommitHash,
  });
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

const verifyUiHandler = (req: Request, res: Response, next: NextFunction) => {
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
};
router.get("/verify-ui", verifyUiHandler);
router.get("/verify-ui/*path", verifyUiHandler);

const repoUiHandler = (req: Request, res: Response) => {
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
};
router.get("/repo-ui", repoUiHandler);
router.get("/repo-ui/*path", repoUiHandler);

router.use("/", apiV1Routes);
router.use("/v2", apiV2Routes);
export default router;
