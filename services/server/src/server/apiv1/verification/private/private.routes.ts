import privateRoutes from "./stateless/private.stateless.routes";

import { Router } from "express";

const router = Router();

router.use("/", privateRoutes);

export default router;
