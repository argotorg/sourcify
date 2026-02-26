import etherscanStatelessRoutes from "./stateless/etherscan.stateless.routes";

import { Router } from "express";

const router = Router();

router.use("/", etherscanStatelessRoutes);

export default router;
