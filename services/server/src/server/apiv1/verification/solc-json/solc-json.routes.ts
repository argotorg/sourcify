import solcJsonStatelessRoutes from "./stateless/solc-json.stateless.routes";

import { Router } from "express";

const router = Router();

router.use("/", solcJsonStatelessRoutes);

export default router;
