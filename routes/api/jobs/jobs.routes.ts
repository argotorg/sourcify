import { Router } from "express";
import { getJobEndpoint } from "./jobs.handler";

const router = Router();

router.route("/verify/:verificationId").get(getJobEndpoint);

export default router;
