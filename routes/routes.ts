import { Router } from "express"; // static is a reserved word
import lookupRoutes from "./api/lookup/lookup.routes";
import jobsRoutes from "./api/jobs/jobs.routes";
import verificationRoutes from "./api/verification/verification.routes";
import { ChainMap } from "../server";

const router: Router = Router();

router.get("/health", (_req, res) => {
  res.status(200).send("Alive and kicking!");
});

router.get("/chains", (_req, res) => {
  const chainMap = _req.app.get("chains") as ChainMap;
  const chainsArray = Object.values(chainMap);
  const chains = chainsArray.map(
    ({
      rpcWithoutApiKeys,
      name,
      title,
      chainId,
      supported,
      etherscanApi,
      confluxscanApi,
      traceSupportedRPCs,
    }) => {
      return {
        name,
        title,
        chainId,
        rpc: rpcWithoutApiKeys,
        traceSupportedRPCs,
        supported,
        etherscanAPI: etherscanApi?.apiURL,
        confluxscanApi: confluxscanApi?.apiURL,
      };
    },
  );

  res.status(200).json(chains);
});

router.use("/", lookupRoutes);
router.use("/", verificationRoutes);
router.use("/", jobsRoutes);

export default router;
