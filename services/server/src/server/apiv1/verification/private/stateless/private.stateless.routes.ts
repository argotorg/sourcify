import { Router } from "express";
import {
  verifyDeprecated,
  upgradeContract,
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

router.route("/private/upgrade-contract").post(
  // Middleware to check if upgradeContract is enabled
  (req, res, next) => {
    const upgradeContractEnabled = req.app.get("upgradeContract") as boolean;
    if (upgradeContractEnabled) {
      next();
    } else {
      res.status(400).send("Not found");
    }
  },
  upgradeContract,
);

export default router;
