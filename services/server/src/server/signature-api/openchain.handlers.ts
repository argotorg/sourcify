import { Request } from "express";
import { StatusCodes } from "http-status-codes";
import { Services } from "../services/services";
import logger from "../../common/logger";
import { RWStorageIdentifiers } from "../services/storageServices/identifiers";
import { SourcifyDatabaseService } from "../services/storageServices/SourcifyDatabaseService";
import { TypedResponse } from "../types";
import {
  SignatureType,
  getCanonicalSignatures,
} from "../services/utils/signature-util";
import { bytesFromString, Tables } from "../services/utils/database-util";
import { QueryResult } from "pg";
import { sendSignatureApiFailure } from "./openchain.validation";

type SignatureApiResponse<T> = TypedResponse<{
  ok: boolean;
  result: T;
}>;

interface SignatureItem {
  name: string;
  filtered: boolean;
}

interface SignatureHashMapping {
  // 4 or 32 byte hash
  [hash: string]: SignatureItem[];
}

interface SignatureResult {
  function: SignatureHashMapping;
  event: SignatureHashMapping;
  error: SignatureHashMapping;
}

function filterResponse(response: SignatureResult, shouldFilter: boolean) {
  const canonicalSignatures = getCanonicalSignatures();

  for (const type of Object.values(SignatureType)) {
    for (const hash in response[type]) {
      const expectedCanonical = canonicalSignatures[hash];
      if (expectedCanonical !== undefined) {
        for (const signatureItem of response[type][hash]) {
          signatureItem.filtered =
            signatureItem.name !== expectedCanonical.signature;
        }
      }
    }
  }

  if (shouldFilter) {
    for (const type of Object.values(SignatureType)) {
      for (const hash in response[type]) {
        response[type][hash] = response[type][hash].filter(
          (signatureItem) => !signatureItem.filtered,
        );
      }
    }
  }
}

type LookupSignaturesRequest = Omit<Request, "query"> & {
  query: {
    function?: string;
    event?: string;
    error?: string;
    filter?: boolean;
  };
};

type LookupSignaturesResponse = SignatureApiResponse<SignatureResult>;

export async function lookupSignatures(
  req: LookupSignaturesRequest,
  res: LookupSignaturesResponse,
) {
  try {
    const {
      function: functionQuery,
      event: eventQuery,
      error: errorQuery,
      filter: shouldFilter = true,
    } = req.query;

    const services = req.app.get("services") as Services;
    const databaseService = services.storage.rwServices[
      RWStorageIdentifiers.SourcifyDatabase
    ] as SourcifyDatabaseService;

    const functionHashes = functionQuery?.split(",") || [];
    const eventHashes = eventQuery?.split(",") || [];
    const errorHashes = errorQuery?.split(",") || [];

    const result: SignatureResult = { function: {}, event: {}, error: {} };

    const getSignatures = async (hash: string, type: SignatureType) => {
      let dbResult: QueryResult<Pick<Tables.Signatures, "signature">>;
      if (hash.length === 66) {
        dbResult = await databaseService.database.getSignatureByHash32AndType(
          bytesFromString(hash),
          type,
        );
      } else {
        dbResult = await databaseService.database.getSignatureByHash4AndType(
          bytesFromString(hash),
          type,
        );
      }
      result[type][hash] = dbResult.rows.map((row) => ({
        name: row.signature,
        filtered: false,
      }));
    };

    await Promise.all([
      ...functionHashes.map((hash) =>
        getSignatures(hash, SignatureType.Function),
      ),
      ...eventHashes.map((hash) => getSignatures(hash, SignatureType.Event)),
      ...errorHashes.map((hash) => getSignatures(hash, SignatureType.Error)),
    ]);

    filterResponse(result, shouldFilter);

    res.status(StatusCodes.OK).json({
      ok: true,
      result,
    });
    return;
  } catch (error) {
    logger.error("Error in lookupSignatures", { error });
    sendSignatureApiFailure(res, "Unexpected failure during signature lookup");
    return;
  }
}

type SearchSignaturesRequest = Omit<Request, "query"> & {
  query: {
    query?: string;
    filter?: boolean;
  };
};

type SearchSignaturesResponse = SignatureApiResponse<SignatureResult>;

export async function searchSignatures(
  req: SearchSignaturesRequest,
  res: SearchSignaturesResponse,
) {
  try {
    const { query: searchQuery = "", filter: shouldFilter = true } = req.query;

    const services = req.app.get("services") as Services;
    const databaseService = services.storage.rwServices[
      RWStorageIdentifiers.SourcifyDatabase
    ] as SourcifyDatabaseService;

    const result: SignatureResult = { function: {}, event: {}, error: {} };

    const searchSignaturesInDb = async (
      pattern: string,
      type: SignatureType,
    ) => {
      const dbResult =
        await databaseService.database.searchSignaturesByPatternAndType(
          pattern,
          type,
        );

      for (const row of dbResult.rows) {
        const hash =
          type === SignatureType.Event
            ? row.signature_hash_32
            : row.signature_hash_4;

        if (!result[type][hash]) {
          result[type][hash] = [];
        }
        result[type][hash].push({
          name: row.signature,
          filtered: false,
        });
      }
    };

    await Promise.all(
      Object.values(SignatureType).map((type) =>
        searchSignaturesInDb(searchQuery, type),
      ),
    );

    filterResponse(result, shouldFilter);

    res.status(StatusCodes.OK).json({
      ok: true,
      result,
    });
  } catch (error) {
    logger.error("Error in searchSignatures", { error });
    sendSignatureApiFailure(res, "Unexpected failure during signature search");
    return;
  }
}

interface GetSignatureStatsResult {
  count: {
    function: number;
    event: number;
    error: number;
  };
  metadata: {
    created_at: string;
    refreshed_at: string;
  };
}

type GetSignaturesStatsResponse = SignatureApiResponse<GetSignatureStatsResult>;

export async function getSignaturesStats(
  req: Request,
  res: GetSignaturesStatsResponse,
) {
  try {
    const services = req.app.get("services") as Services;
    const databaseService = services.storage.rwServices[
      RWStorageIdentifiers.SourcifyDatabase
    ] as SourcifyDatabaseService;

    const result: GetSignatureStatsResult = {
      count: { function: 0, event: 0, error: 0 },
      metadata: {
        created_at: "",
        refreshed_at: "",
      },
    };

    const dbResult = await databaseService.database.getSignatureCounts();

    for (const row of dbResult.rows) {
      result.count[row.signature_type] = row.count;

      // Set metadata from the first row (all rows have same timestamps)
      if (result.metadata.created_at === "") {
        result.metadata.created_at = row.created_at.toISOString();
        result.metadata.refreshed_at = row.refreshed_at.toISOString();
      }
    }

    res.status(StatusCodes.OK).json({
      ok: true,
      result,
    });
    return;
  } catch (error) {
    logger.error("Error in getSignaturesStats", { error });
    sendSignatureApiFailure(
      res,
      "Unexpected failure while getting signature stats",
    );
    return;
  }
}
