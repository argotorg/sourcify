import type {
  SolidityJsonInput,
  VyperJsonInput,
  VerificationExport,
  CompilationTarget,
  Metadata,
} from "@ethereum-sourcify/lib-sourcify";
import { type MatchingErrorResponse } from "../../routes/api/errors";
import { JobErrorData } from "../store/Tables";
import { ConfluxscanResult } from "../utils/confluxscan-util";

export interface VerificationWorkerInput {
  chainId: number;
  address: string;
  traceId?: string;
}

export interface VerifyFromJsonInput extends VerificationWorkerInput {
  jsonInput: SolidityJsonInput | VyperJsonInput;
  compilerVersion: string;
  compilationTarget: CompilationTarget;
  creationTransactionHash?: string;
}

export interface VerifyFromMetadataInput extends VerificationWorkerInput {
  metadata: Metadata;
  sources: Record<string, string>;
  creationTransactionHash?: string;
}

export interface VerifyFromConfluxscanInput extends VerificationWorkerInput {
  confluxscanResult: ConfluxscanResult;
}

export class VerifyError extends Error {
  constructor(public errorExport: VerifyErrorExport) {
    super(
      `The worker task completed with an error. Error export: ${JSON.stringify(errorExport)}`,
    );
  }
}

export type VerifyErrorExport = Omit<MatchingErrorResponse, "message"> & {
  errorData?: JobErrorData;
};

// We need to return an object from the worker for being able to return an
// error with custom properties. Structured clone only copies the default
// properties (name and message) of Error objects when they are thrown, but
// we want to return our custom `MatchingErrorResponse`.
// Any instance of the `VerifyFromJsonOutput` interface should only contain
// one of the two properties.
export interface VerifyOutput {
  verificationExport?: VerificationExport;
  errorExport?: VerifyErrorExport;
}
