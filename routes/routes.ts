import { Router } from "express"; // static is a reserved word
import { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify/build/main/SourcifyChain/SourcifyChainTypes";
import lookupRoutes from "./api/lookup/lookup.routes";
import jobsRoutes from "./api/jobs/jobs.routes";
import verificationRoutes from "./api/verification/verification.routes";

const router: Router = Router();

router.get("/health", (_req, res) => {
  res.status(200).send("Alive and kicking!");
});

router.get("/chains", (_req, res) => {
  const sourcifyChainMap = _req.app.get("chains") as SourcifyChainMap;
  const sourcifyChainsArray = Object.values(sourcifyChainMap)
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
        etherscanAPI: etherscanApi?.apiURL, // Needed in the UI
      };
    },
  );

  res.status(200).json(sourcifyChains);
});

router.use("/", lookupRoutes);
router.use("/", verificationRoutes);
router.use("/", jobsRoutes);

export default router;
