import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Logger } from "winston";
import { SignatureLookupRow, SignatureStatsRow } from "../SignatureDatabase";
import { SignatureType, getCanonicalSignatures } from "../utils/signature-util";
import { bytesFromString } from "../utils/database-util";
import { sendSignatureApiFailure } from "./validation";
import { SignatureDatabase } from "../SignatureDatabase";

interface SignatureItem {
  name: string;
  filtered: boolean;
  hasVerifiedContract: boolean;
}

export interface SignatureHashMapping {
  [hash: string]: SignatureItem[];
}

interface SignatureResult {
  function: SignatureHashMapping;
  event: SignatureHashMapping;
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

function mapLookupResult(rows: SignatureLookupRow[]): SignatureItem[] {
  return rows.map((row) => ({
    name: row.signature,
    filtered: false,
    hasVerifiedContract: row.has_verified_contract,
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

type LookupSignaturesRequest = Omit<Request, "query"> & {
  query: {
    function?: string;
    event?: string;
    filter?: "true" | "false";
  };
};

type SearchSignaturesRequest = Omit<Request, "query"> & {
  query: { query: string; filter?: "true" | "false" };
};

export interface SignatureHandlers {
  lookupSignatures: (
    req: LookupSignaturesRequest,
    res: Response,
  ) => Promise<void>;
  searchSignatures: (
    req: SearchSignaturesRequest,
    res: Response,
  ) => Promise<void>;
  getSignaturesStats: (req: Request, res: Response) => Promise<void>;
}

export function createSignatureHandlers(
  database: SignatureDatabase,
  logger: Logger,
): SignatureHandlers {
  return {
    lookupSignatures: async (req, res) => {
      try {
        const functionHashes = sanitizeHashes(req.query.function);
        const eventHashes = sanitizeHashes(req.query.event);
        const shouldFilter = sanitizeFilter(req.query.filter);

        const result: SignatureResult = { function: {}, event: {} };

        const getFunctionSignatures = async (hash: string) => {
          const rows =
            hash.length === 66
              ? await database.getSignatureByHash32(bytesFromString(hash)!)
              : await database.getSignatureByHash4(bytesFromString(hash)!);

          result.function[hash] = mapLookupResult(rows);
        };

        const getEventSignatures = async (hash: string) => {
          const rows = await database.getSignatureByHash32(bytesFromString(hash)!);
          result.event[hash] = mapLookupResult(rows);
        };

        await Promise.all([
          ...functionHashes.map(getFunctionSignatures),
          ...eventHashes.map(getEventSignatures),
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

        const result: SignatureResult = { function: {}, event: {} };

        const rows = await database.searchSignaturesByPattern(searchQuery);

        for (const row of rows) {
          // Add signatures to both function and event categories since we can't reliably
          // determine the type from signature text alone
          const signatureItem = {
            name: row.signature,
            filtered: false,
            hasVerifiedContract: row.has_verified_contract,
          };

          // Add to function category using 4-byte hash
          if (!result.function[row.signature_hash_4]) {
            result.function[row.signature_hash_4] = [];
          }
          result.function[row.signature_hash_4].push(signatureItem);

          // Add to event category using 32-byte hash
          if (!result.event[row.signature_hash_32]) {
            result.event[row.signature_hash_32] = [];
          }
          result.event[row.signature_hash_32].push(signatureItem);
        }

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
          count: { function: 0, event: 0, error: 0, unknown: 0, total: 0 },
          metadata: { refreshed_at: "" },
        };

        for (const row of rows) {
          if ((row.signature_type as string) === 'unknown') {
            stats.count.unknown = parseInt(row.count, 10);
          } else if ((row.signature_type as string) === 'total') {
            stats.count.total = parseInt(row.count, 10);
          } else {
            stats.count[row.signature_type] = parseInt(row.count, 10);
          }

          if (stats.metadata.refreshed_at === "") {
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
