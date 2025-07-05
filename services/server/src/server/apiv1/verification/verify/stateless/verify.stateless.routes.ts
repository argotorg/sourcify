import { Router } from "express";
import { legacyVerifyEndpoint } from "./verify.stateless.handlers";
import { checkPerfectMatch } from "../../../controllers.common";

const router: Router = Router();

router.route("/verify").post(checkPerfectMatch, legacyVerifyEndpoint);

export const deprecatedRoutesVerifyStateless = {
  "/": {
    method: "post",
    path: "/verify",
  },
};

export default router;
