import { Router } from "express";
import { postBigQueryEndpoint } from "./bigquery.handler";

const router = Router();

router.route("/bigquery").post(postBigQueryEndpoint);

export default router;
