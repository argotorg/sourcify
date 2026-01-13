import type { StorageServiceOptions } from "./StorageService";
import { StorageService } from "./StorageService";
import type { VerificationServiceOptions } from "./VerificationService";
import { VerificationService } from "./VerificationService";

export class Services {
  public verification: VerificationService;
  public storage: StorageService;

  constructor(
    verificationServiceOptions: VerificationServiceOptions,
    storageServiceOptions: StorageServiceOptions,
  ) {
    this.storage = new StorageService(storageServiceOptions);
    this.verification = new VerificationService(
      verificationServiceOptions,
      this.storage,
    );
  }

  public async init() {
    await this.storage.init();
    await this.verification.init();
  }

  public async close() {
    await this.verification.close();
    await this.storage.close();
  }
}
