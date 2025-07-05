import { StorageService, StorageServiceOptions } from "./StorageService";
import {
  VerificationService,
  VerificationServiceOptions,
} from "./VerificationService";

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
  }
}
