import { Router } from "express";
import { verifyDeprecated, replaceContract } from "./handlers";
import { checksumAddresses, checkPerfectMatch } from "./util";

const router: Router = Router();

// checksum addresses in every private request
router.use(checksumAddresses);

router.route("/verify-deprecated").post(
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

router.route("/replace-contract").post(
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
