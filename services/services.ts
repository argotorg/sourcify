import {
  VerificationService,
  VerificationOptions,
} from "./verification/VerificationService";
import { StoreService } from "./store/StoreService";
import { DatabaseOptions } from "../config/Loader";

export class Services {
  public store: StoreService;
  public verification: VerificationService;

  constructor(
    verificationOptions: VerificationOptions,
    databaseOptions: DatabaseOptions,
  ) {
    this.store = new StoreService(databaseOptions);
    this.verification = new VerificationService(
      verificationOptions,
      this.store,
    );
  }

  public async init() {
    await this.verification.init();
    await this.store.init();
  }

  public async close() {
    await this.verification.close();
  }
}
