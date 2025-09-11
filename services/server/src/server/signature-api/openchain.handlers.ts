import { Request } from "express";
import { StatusCodes } from "http-status-codes";
import { Services } from "../services/services";
import logger from "../../common/logger";
import { RWStorageIdentifiers } from "../services/storageServices/identifiers";
import { SourcifyDatabaseService } from "../services/storageServices/SourcifyDatabaseService";
import { TypedResponse } from "../types";
import { SignatureType } from "../services/utils/signature-util";
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
}

interface LookupSignaturesRequest extends Request {
  query: {
    function?: string;
    event?: string;
    filter?: "true" | "false";
  };
}

type LookupSignaturesResponse = SignatureApiResponse<SignatureResult>;

export async function lookupSignatures(
  req: LookupSignaturesRequest,
  res: LookupSignaturesResponse,
) {
  try {
    const {
      function: functionQuery,
      event: eventQuery,
      filter: shouldFilter = "true",
    } = req.query;
    // TODO: Implement filtering logic when shouldFilter is true
    const services = req.app.get("services") as Services;
    const databaseService = services.storage.rwServices[
      RWStorageIdentifiers.SourcifyDatabase
    ] as SourcifyDatabaseService;

    const functionHashes = functionQuery?.split(",") || [];
    const eventHashes = eventQuery?.split(",") || [];

    const result: SignatureResult = { function: {}, event: {} };

    const getSignatures = async (
      hash: string,
      type: Exclude<SignatureType, "error">,
    ) => {
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
      ...functionHashes.map((hash) => getSignatures(hash, "function")),
      ...eventHashes.map((hash) => getSignatures(hash, "event")),
    ]);

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

interface SearchSignaturesRequest extends Request {
  query: {
    query: string;
    filter?: "true" | "false";
  };
}

type SearchSignaturesResponse = SignatureApiResponse<SignatureResult>;

export async function searchSignatures(
  req: SearchSignaturesRequest,
  res: SearchSignaturesResponse,
) {
  try {
    const { query: searchQuery, filter: shouldFilter = "true" } = req.query;
    // TODO: Implement filtering logic when shouldFilter is true

    const services = req.app.get("services") as Services;
    const databaseService = services.storage.rwServices[
      RWStorageIdentifiers.SourcifyDatabase
    ] as SourcifyDatabaseService;

    const result: SignatureResult = { function: {}, event: {} };

    const searchSignaturesInDb = async (
      pattern: string,
      type: Exclude<SignatureType, "error">,
    ) => {
      const dbResult =
        await databaseService.database.searchSignaturesByPatternAndType(
          pattern,
          type,
        );

      for (const row of dbResult.rows) {
        const hash =
          type === "event" ? row.signature_hash_32 : row.signature_hash_4;

        if (!result[type][hash]) {
          result[type][hash] = [];
        }
        result[type][hash].push({
          name: row.signature,
          filtered: false,
        });
      }
    };

    await Promise.all([
      searchSignaturesInDb(searchQuery, "function"),
      searchSignaturesInDb(searchQuery, "event"),
    ]);

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
      count: { function: 0, event: 0 },
    };

    const getSignatureCount = async (type: Exclude<SignatureType, "error">) => {
      const dbResult =
        await databaseService.database.getSignatureCountByType(type);

      if (dbResult.rows.length === 0) {
        throw new Error(`No rows returned from count query for type ${type}`);
      }

      result.count[type] = parseInt(dbResult.rows[0].count, 10);
    };

    await Promise.all([
      getSignatureCount("function"),
      getSignatureCount("event"),
    ]);

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
