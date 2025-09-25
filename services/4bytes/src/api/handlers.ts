import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Logger } from "winston";
import {
  SignatureDataProvider,
  SignatureLookupRow,
  SignatureStatsRow,
} from "../SignatureDatabase";
import { SignatureType, getCanonicalSignatures } from "../utils/signature-util";
import { bytesFromString } from "../utils/database-util";
import { sendSignatureApiFailure } from "./validation";

interface SignatureItem {
  name: string;
  filtered: boolean;
}

export interface SignatureHashMapping {
  [hash: string]: SignatureItem[];
}

interface SignatureResult {
  function: SignatureHashMapping;
  event: SignatureHashMapping;
  error: SignatureHashMapping;
}

function filterResponse(response: SignatureResult, shouldFilter: boolean) {
  const canonicalSignatures = getCanonicalSignatures();

  for (const hash in response.function) {
    const expectedCanonical = canonicalSignatures[hash];
    if (expectedCanonical !== undefined) {
      for (const signatureItem of response.function[hash]) {
        signatureItem.filtered =
          signatureItem.name !== expectedCanonical.signature;
      }
    }
  }

  if (shouldFilter) {
    for (const hash in response.function) {
      response.function[hash] = response.function[hash].filter(
        (signatureItem) => !signatureItem.filtered,
      );
    }
  }
}

function mapLookupResult(rows: SignatureLookupRow[]): SignatureItem[] {
  return rows.map((row) => ({
    name: row.signature,
    filtered: false,
  }));
}

function sanitizeHashes(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((hash) => hash.trim())
    .filter((hash) => hash.length > 0);
}

function sanitizeFilter(filter: string | undefined): boolean {
  if (!filter) {
    return true;
  }
  return filter === "true";
}

type LookupSignaturesRequest = Request<
  unknown,
  unknown,
  unknown,
  { function?: string; event?: string; error?: string; filter?: string }
>;

export interface SignatureHandlers {
  lookupSignatures: (
    req: LookupSignaturesRequest,
    res: Response,
  ) => Promise<void>;
  searchSignatures: (
    req: Request<unknown, unknown, unknown, { query: string; filter?: string }>,
    res: Response,
  ) => Promise<void>;
  getSignaturesStats: (req: Request, res: Response) => Promise<void>;
}

export function createSignatureHandlers(
  database: SignatureDataProvider,
  logger: Logger,
): SignatureHandlers {
  return {
    lookupSignatures: async (req, res) => {
      try {
        const functionHashes = sanitizeHashes(req.query.function);
        const eventHashes = sanitizeHashes(req.query.event);
        const errorHashes = sanitizeHashes(req.query.error);
        const shouldFilter = sanitizeFilter(req.query.filter);

        const result: SignatureResult = { function: {}, event: {}, error: {} };

        const getSignatures = async (hash: string, type: SignatureType) => {
          const rows =
            hash.length === 66
              ? await database.getSignatureByHash32AndType(
                  bytesFromString(hash)!,
                  type,
                )
              : await database.getSignatureByHash4AndType(
                  bytesFromString(hash)!,
                  type,
                );

          result[type][hash] = mapLookupResult(rows);
        };

        await Promise.all([
          ...functionHashes.map((hash) =>
            getSignatures(hash, SignatureType.Function),
          ),
          ...eventHashes.map((hash) =>
            getSignatures(hash, SignatureType.Event),
          ),
          ...errorHashes.map((hash) =>
            getSignatures(hash, SignatureType.Error),
          ),
        ]);

        filterResponse(result, shouldFilter);

        res.status(StatusCodes.OK).json({
          ok: true,
          result,
        });
      } catch (error) {
        logger.error("Error in lookupSignatures", { error });
        sendSignatureApiFailure(
          res,
          "Unexpected failure during signature lookup",
        );
      }
    },

    searchSignatures: async (req, res) => {
      try {
        const searchQuery = req.query.query;
        const shouldFilter = sanitizeFilter(req.query.filter);

        const result: SignatureResult = { function: {}, event: {}, error: {} };

        const searchSignaturesInDb = async (
          pattern: string,
          type: SignatureType,
        ) => {
          const rows = await database.searchSignaturesByPatternAndType(
            pattern,
            type,
          );

          for (const row of rows) {
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
        sendSignatureApiFailure(
          res,
          "Unexpected failure during signature search",
        );
      }
    },

    getSignaturesStats: async (_req, res) => {
      try {
        const rows: SignatureStatsRow[] = await database.getSignatureCounts();

        const stats = {
          count: { function: 0, event: 0, error: 0 },
          metadata: { created_at: "", refreshed_at: "" },
        };

        for (const row of rows) {
          stats.count[row.signature_type] = parseInt(row.count, 10);

          if (stats.metadata.created_at === "") {
            stats.metadata.created_at = row.created_at.toISOString();
            stats.metadata.refreshed_at = row.refreshed_at.toISOString();
          }
        }

        res.status(StatusCodes.OK).json({
          ok: true,
          result: stats,
        });
      } catch (error) {
        logger.error("Error in getSignaturesStats", { error });
        sendSignatureApiFailure(
          res,
          "Unexpected failure while getting signature stats",
        );
      }
    },
  };
}
