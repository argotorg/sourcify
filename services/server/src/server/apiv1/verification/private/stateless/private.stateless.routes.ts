import { Router } from "express";
import {
  verifyDeprecated,
  replaceContract,
} from "./private.stateless.handlers";
import { checkPerfectMatch } from "../../../controllers.common";

const router: Router = Router();

router.route("/private/verify-deprecated").post(
  // Middleware to check if verifyDeprecated is enabled
  (req, res, next) => {
    const verifyDeprecatedEnabled = req.app.get("verifyDeprecated") as boolean;
    if (verifyDeprecatedEnabled) {
      next();
    } else {
      res.status(400).send("Not found");
    }
  },
  checkPerfectMatch,
  verifyDeprecated,
);

router.route("/private/replace-contract").post(
  // Middleware to check if replaceContract is enabled
  (req, res, next) => {
    const replaceContractEnabled = req.app.get("replaceContract") as boolean;
    if (replaceContractEnabled) {
      next();
    } else {
      res.status(400).send("Not found");
    }
  },
  replaceContract,
);

export default router;
