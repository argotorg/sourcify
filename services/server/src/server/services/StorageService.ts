import { VerificationExport } from "@ethereum-sourcify/lib-sourcify";
import {
  RepositoryV1Service,
  RepositoryV1ServiceOptions,
} from "./storageServices/RepositoryV1Service";
import {
  RepositoryV2Service,
  RepositoryV2ServiceOptions,
} from "./storageServices/RepositoryV2Service";
import { SourcifyDatabaseService } from "./storageServices/SourcifyDatabaseService";
import { AllianceDatabaseService } from "./storageServices/AllianceDatabaseService";
import logger from "../../common/logger";
import {
  ContractData,
  FileObject,
  FilesInfo,
  Mandatory,
  V1MatchLevel,
  V1MatchLevelWithoutAny,
  MethodArgs,
  MethodNames,
  MethodReturnType,
  PaginatedData,
  VerifiedContractMinimal,
  VerifiedContract,
  VerificationJob,
  Match,
  VerificationJobId,
} from "../types";
import {
  RWStorageIdentifiers,
  StorageIdentifiers,
  WStorageIdentifiers,
} from "./storageServices/identifiers";
import { ConflictError } from "../../common/errors/ConflictError";
import { isBetterVerification } from "./utils/util";
import {
  S3RepositoryService,
  S3RepositoryServiceOptions,
} from "./storageServices/S3RepositoryService";
import { DatabaseOptions } from "./utils/Database";
import { Field } from "./utils/database-util";
import { VerifyErrorExport } from "./workers/workerTypes";

export interface WStorageService {
  IDENTIFIER: StorageIdentifiers;
  init(): Promise<boolean>;
  storeVerification(
    verification: VerificationExport,
    jobData?: {
      verificationId: VerificationJobId;
      finishTime: Date;
    },
  ): Promise<void>;
  storeVerificationJob?(
    startedAt: Date,
    chainId: string,
    address: string,
    verificationEndpoint: string,
  ): Promise<VerificationJobId>;
  setJobError?(
    verificationId: VerificationJobId,
    finishTime: Date,
    error: VerifyErrorExport,
  ): Promise<void>;
}

export interface RWStorageService extends WStorageService {
  getFile(
    chainId: string,
    address: string,
    match: V1MatchLevelWithoutAny,
    path: string,
  ): Promise<string | false>;
  getTree(
    chainId: string,
    address: string,
    match: V1MatchLevel,
  ): Promise<FilesInfo<string[]>>;
  getContent(
    chainId: string,
    address: string,
    match: V1MatchLevel,
  ): Promise<FilesInfo<Array<FileObject>>>;
  getContracts(chainId: string): Promise<ContractData>;
  getPaginatedContractAddresses?(
    chainId: string,
    match: V1MatchLevel,
    page: number,
    limit: number,
    descending: boolean,
  ): Promise<PaginatedData<string>>;
  checkByChainAndAddress(address: string, chainId: string): Promise<Match[]>;
  checkAllByChainAndAddress(address: string, chainId: string): Promise<Match[]>;
  getContractsByChainId?(
    chainId: string,
    limit: number,
    descending: boolean,
    afterMatchId?: string,
  ): Promise<{ results: VerifiedContractMinimal[] }>;
  getContract?(
    chainId: string,
    address: string,
    fields?: Field[],
    omit?: Field[],
  ): Promise<VerifiedContract>;
  getContractsAllChains?(
    address: string,
  ): Promise<{ results: VerifiedContractMinimal[] }>;
  getVerificationJob?(verificationId: string): Promise<VerificationJob | null>;
  getVerificationJobsByChainAndAddress?(
    chainId: string,
    address: string,
  ): Promise<Pick<VerificationJob, "isJobCompleted">[]>;
}

export interface EnabledServices {
  read: RWStorageIdentifiers;
  writeOrWarn: StorageIdentifiers[];
  writeOrErr: StorageIdentifiers[];
}

export interface StorageServiceOptions {
  serverUrl: string;
  enabledServices: EnabledServices;
  repositoryV1ServiceOptions?: RepositoryV1ServiceOptions;
  repositoryV2ServiceOptions?: RepositoryV2ServiceOptions;
  sourcifyDatabaseServiceOptions?: DatabaseOptions;
  allianceDatabaseServiceOptions?: DatabaseOptions;
  s3RepositoryServiceOptions?: S3RepositoryServiceOptions;
}

export class StorageService {
  enabledServices: EnabledServices;

  rwServices: { [key in RWStorageIdentifiers]: RWStorageService } = {} as {
    [key in RWStorageIdentifiers]: RWStorageService;
  };
  wServices: { [key in StorageIdentifiers]: WStorageService } = {} as {
    [key in StorageIdentifiers]: WStorageService;
  };

  constructor(options: StorageServiceOptions) {
    this.enabledServices = options.enabledServices;

    const enabledServicesArray = [
      this.enabledServices.read,
      ...this.enabledServices.writeOrWarn,
      ...this.enabledServices.writeOrErr,
    ];

    // repositoryV1
    if (enabledServicesArray.includes(RWStorageIdentifiers.RepositoryV1)) {
      if (options.repositoryV1ServiceOptions?.repositoryPath) {
        const repositoryV1 = new RepositoryV1Service(
          options.repositoryV1ServiceOptions,
          options.serverUrl,
        );
        this.rwServices[repositoryV1.IDENTIFIER] = repositoryV1;
      } else {
        logger.error(
          "RepositoryV1 enabled, but path not set",
          options.repositoryV2ServiceOptions,
        );
        throw new Error("RepositoryV1 enabled, but path not set");
      }
    }

    // repositoryV2
    if (enabledServicesArray.includes(WStorageIdentifiers.RepositoryV2)) {
      if (options.repositoryV2ServiceOptions?.repositoryPath) {
        const repositoryV2 = new RepositoryV2Service(
          options.repositoryV2ServiceOptions,
        );
        this.wServices[repositoryV2.IDENTIFIER] = repositoryV2;
      } else {
        logger.error(
          "RepositoryV2 enabled, but path not set",
          options.repositoryV2ServiceOptions,
        );
        throw new Error("RepositoryV2 enabled, but path not set");
      }
    }

    // SourcifyDatabase
    if (enabledServicesArray.includes(RWStorageIdentifiers.SourcifyDatabase)) {
      if (
        options.sourcifyDatabaseServiceOptions?.postgres?.host &&
        options.sourcifyDatabaseServiceOptions?.postgres?.database &&
        options.sourcifyDatabaseServiceOptions?.postgres?.user &&
        options.sourcifyDatabaseServiceOptions?.postgres?.password
      ) {
        const sourcifyDatabase = new SourcifyDatabaseService(
          options.sourcifyDatabaseServiceOptions,
          options.serverUrl,
        );
        this.rwServices[sourcifyDatabase.IDENTIFIER] = sourcifyDatabase;
      } else {
        logger.error(
          "SourcifyDatabase enabled, but options are not complete",
          options.sourcifyDatabaseServiceOptions,
        );
        throw new Error(
          "SourcifyDatabase enabled, but options are not complete",
        );
      }
    }

    // AllianceDatabase
    if (enabledServicesArray.includes(WStorageIdentifiers.AllianceDatabase)) {
      if (
        (options.allianceDatabaseServiceOptions?.googleCloudSql?.instanceName &&
          options.allianceDatabaseServiceOptions?.googleCloudSql?.database &&
          options.allianceDatabaseServiceOptions?.googleCloudSql?.user &&
          options.allianceDatabaseServiceOptions?.googleCloudSql?.password) ||
        (options.allianceDatabaseServiceOptions?.postgres?.host &&
          options.allianceDatabaseServiceOptions?.postgres?.database &&
          options.allianceDatabaseServiceOptions?.postgres?.user &&
          options.allianceDatabaseServiceOptions?.postgres?.password)
      ) {
        const allianceDatabase = new AllianceDatabaseService(
          options.allianceDatabaseServiceOptions,
        );
        this.wServices[allianceDatabase.IDENTIFIER] = allianceDatabase;
      } else {
        logger.error(
          "AllianceDatabase enabled, but options are not complete",
          options.allianceDatabaseServiceOptions,
        );
        throw new Error(
          "AllianceDatabase enabled, but options are not complete",
        );
      }
    }

    // S3RepositoryService
    if (enabledServicesArray.includes(WStorageIdentifiers.S3Repository)) {
      if (
        options.s3RepositoryServiceOptions?.bucket &&
        options.s3RepositoryServiceOptions?.region &&
        options.s3RepositoryServiceOptions?.accessKeyId &&
        options.s3RepositoryServiceOptions?.secretAccessKey
      ) {
        const s3repository = new S3RepositoryService(
          options.s3RepositoryServiceOptions,
        );
        this.wServices[s3repository.IDENTIFIER] = s3repository;
      } else {
        logger.error(
          "S3Repository enabled, but S3 options are not fully set",
          options.s3RepositoryServiceOptions,
        );
        throw new Error(
          "S3Repository enabled, but S3 options are not fully set",
        );
      }
    }
  }

  getRWServiceByConfigKey(configKey: RWStorageIdentifiers): RWStorageService {
    return this.rwServices[configKey];
  }

  getWServiceByConfigKey(configKey: StorageIdentifiers): WStorageService {
    return { ...this.rwServices, ...this.wServices }[configKey];
  }

  getDefaultReadService(): RWStorageService {
    return this.getRWServiceByConfigKey(this.enabledServices.read);
  }

  getWriteOrWarnServices(): WStorageService[] {
    return this.enabledServices.writeOrWarn.map((serviceKey) =>
      this.getWServiceByConfigKey(serviceKey),
    );
  }

  getWriteOrErrServices(): WStorageService[] {
    return this.enabledServices.writeOrErr.map((serviceKey) =>
      this.getWServiceByConfigKey(serviceKey),
    );
  }

  async init() {
    // Initialized only the used storage services

    // Get list of used storage services
    const enabledServicesArray = [
      this.getDefaultReadService(),
      ...this.getWriteOrWarnServices(),
      ...this.getWriteOrErrServices(),
    ].filter((service) => service !== undefined) as WStorageService[];

    logger.debug("Initializing used storage services", {
      storageServices: enabledServicesArray.map(
        (service) => service.IDENTIFIER,
      ),
    });

    // Try to initialize used storage services
    for (const service of enabledServicesArray) {
      logger.debug(`Initializing storage service: ${service.IDENTIFIER}`);
      if (!(await service.init())) {
        throw new Error(
          "Cannot initialize default storage service: " + service.IDENTIFIER,
        );
      }
    }
  }

  async storeVerification(
    verification: VerificationExport,
    jobData?: {
      verificationId: VerificationJobId;
      finishTime: Date;
    },
  ) {
    logger.info("Storing verification on StorageService", {
      address: verification.address,
      chainId: verification.chainId,
      runtimeMatch: verification.status.runtimeMatch,
      creationMatch: verification.status.creationMatch,
    });

    const existingMatch = await this.performServiceOperation(
      "checkAllByChainAndAddress",
      [verification.address, verification.chainId.toString()],
    );
    if (
      existingMatch.length > 0 &&
      !isBetterVerification(verification, existingMatch[0])
    ) {
      logger.info("Partial match already exists", {
        chain: verification.chainId,
        address: verification.address,
        newRuntimeMatch: verification.status.runtimeMatch,
        newCreationMatch: verification.status.creationMatch,
        existingRuntimeMatch: existingMatch[0].runtimeMatch,
        existingCreationMatch: existingMatch[0].creationMatch,
      });
      throw new ConflictError(
        `The contract ${verification.address} on chainId ${verification.chainId} is already partially verified. The provided new source code also yielded a partial match and will not be stored unless it's a full match`,
      );
    }

    // Initialize an array to hold active service promises
    const promises: Promise<void>[] = [];

    this.getWriteOrErrServices().forEach((service) => {
      promises.push(
        service.storeVerification(verification, jobData).catch((e) => {
          logger.error(`Error storing to ${service.IDENTIFIER}`, {
            error: e,
            verification,
          });
          throw e;
        }),
      );
    });

    this.getWriteOrWarnServices().forEach((service) => {
      promises.push(
        service.storeVerification(verification, jobData).catch((e) => {
          logger.warn(`Error storing to ${service.IDENTIFIER}`, {
            error: e,
            verification,
          });
        }),
      );
    });

    await Promise.all(promises);
  }

  performServiceOperation<
    T extends Mandatory<RWStorageService>, // Mandatory is used to allow optional functions like getPaginatedContracts
    K extends MethodNames<T>, // MethodNames extracts T's methods
  >(
    methodName: K,
    // MethodArgs gets the parameters types of method K from T
    args: MethodArgs<T, K>,
  ): MethodReturnType<T, K> {
    const service = this.getDefaultReadService() as T;
    const method = service[methodName];
    try {
      if (typeof method !== "function") {
        throw new Error(
          `The method ${String(methodName)} doesn't exist or is not a function`,
        );
      }

      return method.apply(service, args);
    } catch (error) {
      logger.error(
        `Error while calling ${String(methodName)} from ${service.IDENTIFIER}`,
        {
          defaultStorageService: this.getDefaultReadService().IDENTIFIER,
          args,
          error,
        },
      );
      throw error;
    }
  }
}
