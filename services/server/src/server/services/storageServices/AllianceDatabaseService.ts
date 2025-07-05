import logger from "../../../common/logger";
import AbstractDatabaseService from "./AbstractDatabaseService";
import { WStorageService } from "../StorageService";
import { VerificationExport } from "@ethereum-sourcify/lib-sourcify";
import { WStorageIdentifiers } from "./identifiers";

export class AllianceDatabaseService
  extends AbstractDatabaseService
  implements WStorageService
{
  IDENTIFIER = WStorageIdentifiers.AllianceDatabase;

  async storeVerification(verification: VerificationExport) {
    if (!verification.status.creationMatch) {
      throw new Error("Can't store to AllianceDatabase without creationMatch");
    }
    await super.insertOrUpdateVerification(verification);
    logger.info("Stored to AllianceDatabase", {
      name: verification.compilation.compilationTarget.name,
      address: verification.address,
      chainId: verification.chainId,
      runtimeMatch: verification.status.runtimeMatch,
      creationMatch: verification.status.creationMatch,
    });
  }
}
