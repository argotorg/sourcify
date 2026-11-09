import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { Logger } from "winston";
import type {
  SignatureLookupRow,
  SignatureInsertResult,
  RecentSignaturesCursor,
} from "../SignatureDatabase";
import type { SignatureStats } from "../SignatureStats";
import {
  getCanonicalSignatures,
  validateSignature,
} from "../utils/signature-util";
import { bytesFromString } from "../utils/database-util";
import { sendSignatureApiFailure } from "./validation";
import type { SignatureDatabase } from "../SignatureDatabase";

interface SignatureItem {
  name: string;
  filtered: boolean;
  hasVerifiedContract: boolean;
}

export interface SignatureHashMapping {
  [hash: string]: SignatureItem[] | null;
}

interface SignatureResult {
  function: SignatureHashMapping;
  event: SignatureHashMapping;
}

interface ImportResult {
  imported: { [signature: string]: string };
  duplicated: { [signature: string]: string };
  invalid: string[];
}

function filterResponse(response: SignatureResult, shouldFilter: boolean) {
  const canonicalSignatures = getCanonicalSignatures();

  for (const type of Object.keys(response) as (keyof SignatureResult)[]) {
    for (const hash in response[type]) {
      const expectedCanonical = canonicalSignatures[hash];
      if (expectedCanonical !== undefined && response[type][hash] !== null) {
        for (const signatureItem of response[type][hash]) {
          signatureItem.filtered =
            signatureItem.name !== expectedCanonical.signature;
        }
      }
    }
  }

  if (shouldFilter) {
    for (const type of Object.keys(response) as (keyof SignatureResult)[]) {
      for (const hash in response[type]) {
        if (response[type][hash] === null) {
          continue;
        }
        response[type][hash] = response[type][hash].filter(
          (signatureItem) => !signatureItem.filtered,
        );
      }
    }
  }
}

// How long a shared cache (CDN) and a client may store a lookup response in which every
// hash has a signature. Clients get a short time because a CDN purge cannot reach them.
const LOOKUP_CDN_MAX_AGE_SECONDS = 3600;
const LOOKUP_CLIENT_MAX_AGE_SECONDS = 60;

// True if at least one hash was requested and every hash has at least one signature
function hasSignaturesForAllHashes(response: SignatureResult): boolean {
  const signatureLists = [
    ...Object.values(response.function),
    ...Object.values(response.event),
  ];
  return (
    signatureLists.length > 0 &&
    signatureLists.every(
      (signatureItems) => signatureItems !== null && signatureItems.length > 0,
    )
  );
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

type RecentSignaturesRequest = Omit<Request, "query"> & {
  query: { since?: string; cursor?: string; limit?: string };
};

export const RECENT_DEFAULT_LIMIT = 100;
export const RECENT_MAX_LIMIT = 500;
export const RECENT_MAX_SINCE_AGE_MS = 24 * 60 * 60 * 1000;
const RECENT_DEFAULT_SINCE_AGE_MS = 60 * 60 * 1000;

// The format of createdAt in the response. Postgres reads it as UTC, with
// microseconds, so the cursor keeps the exact position.
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

// The cursor is "<createdAt>_<signatureHash32>" of the last item of a page
function parseRecentCursor(raw: string): RecentSignaturesCursor | undefined {
  const [createdAt, hash, ...rest] = raw.split("_");
  if (
    rest.length > 0 ||
    !CURSOR_TIME.test(createdAt ?? "") ||
    isNaN(new Date(createdAt).getTime()) ||
    !/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")
  ) {
    return undefined;
  }
  return { createdAt, signatureHash32: bytesFromString(hash)! };
}

type ImportSignaturesRequest = Omit<Request, "body"> & {
  body: {
    function?: string[];
    event?: string[];
  };
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
  importSignatures: (
    req: ImportSignaturesRequest,
    res: Response,
  ) => Promise<void>;
  getSignaturesStats: (req: Request, res: Response) => Promise<void>;
  getRecentSignatures: (
    req: RecentSignaturesRequest,
    res: Response,
  ) => Promise<void>;
}

export function createSignatureHandlers(
  database: SignatureDatabase,
  stats: SignatureStats,
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
          if (hash.length !== 10) {
            result.function[hash] = null;
            return;
          }
          const rows = await database.getSignatureByHash4(
            bytesFromString(hash)!,
          );

          result.function[hash] =
            rows.length > 0 ? mapLookupResult(rows) : null; // Weirdly, openchain API returns empty array for events, but null for functions
        };

        const getEventSignatures = async (hash: string) => {
          if (hash.length !== 66) {
            result.event[hash] = [];
            return;
          }
          const rows = await database.getSignatureByHash32(
            bytesFromString(hash)!,
          );
          result.event[hash] = mapLookupResult(rows);
          // Weirdly, openchain API returns empty array for events, but null for functions
          // result.event[hash] = rows.length > 0 ? mapLookupResult(rows) : null;
        };

        await Promise.all([
          ...functionHashes.map(getFunctionSignatures),
          ...eventHashes.map(getEventSignatures),
        ]);

        filterResponse(result, shouldFilter);

        // Only complete answers are cacheable, so a newly imported signature for an unknown
        // hash shows immediately. A cached answer can still be stale until it expires: a new
        // signature with the same hash (collision) and a change of hasVerifiedContract are
        // not in it.
        res.set(
          "Cache-Control",
          hasSignaturesForAllHashes(result)
            ? `public, max-age=${LOOKUP_CLIENT_MAX_AGE_SECONDS}, s-maxage=${LOOKUP_CDN_MAX_AGE_SECONDS}`
            : "no-store",
        );
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
          result.function[row.signature_hash_4]!.push(signatureItem);

          // Add to event category using 32-byte hash
          if (!result.event[row.signature_hash_32]) {
            result.event[row.signature_hash_32] = [];
          }
          result.event[row.signature_hash_32]!.push(signatureItem);
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

    importSignatures: async (req, res) => {
      try {
        const functionSignatures = req.body.function || [];
        const eventSignatures = req.body.event || [];

        if (functionSignatures.length === 0 && eventSignatures.length === 0) {
          res.status(StatusCodes.BAD_REQUEST).json({
            ok: false,
            error: "No signatures provided",
          });
          return;
        }

        // Process function and event signatures
        const functionResults: ImportResult = {
          imported: {},
          duplicated: {},
          invalid: [],
        };
        const eventResults: ImportResult = {
          imported: {},
          duplicated: {},
          invalid: [],
        };

        const signatureTypes = [
          // We'll iterate over once for function and once for event signatures. Same logic with different hash selectors (4byte and 32byte)
          {
            signatures: functionSignatures,
            hashSelector: (r: SignatureInsertResult) => r.signature_hash_4,
            results: functionResults,
          },
          {
            signatures: eventSignatures,
            hashSelector: (r: SignatureInsertResult) => r.signature_hash_32,
            results: eventResults,
          },
        ];

        for (const { signatures, hashSelector, results } of signatureTypes) {
          if (signatures.length > 0) {
            // Validate signatures
            const validSigs: string[] = [];
            for (const sig of signatures) {
              if (validateSignature(sig)) {
                validSigs.push(sig);
              } else {
                results.invalid.push(sig);
              }
            }

            // Insert valid signatures and process results
            if (validSigs.length > 0) {
              const insertResults = await database.insertSignatures(validSigs);
              for (const result of insertResults) {
                const hash = hashSelector(result);

                if (result.was_inserted) {
                  results.imported[result.signature] = hash;
                } else {
                  results.duplicated[result.signature] = hash;
                }
              }
            }
          }
        }

        res.status(StatusCodes.OK).json({
          ok: true,
          result: {
            function: functionResults,
            event: eventResults,
          },
        });
      } catch (error) {
        logger.error("Error in importSignatures", { error });
        sendSignatureApiFailure(
          res,
          "Unexpected failure during signature import",
        );
      }
    },

    getSignaturesStats: async (_req, res) => {
      try {
        const result = await stats.getStats();
        res.status(StatusCodes.OK).json({
          ok: true,
          result,
        });
      } catch (error) {
        logger.error("Error in getSignaturesStats", { error });
        sendSignatureApiFailure(
          res,
          "Unexpected failure while getting signature stats",
        );
      }
    },

    getRecentSignatures: async (req, res) => {
      const badRequest = (error: string) => {
        res.status(StatusCodes.BAD_REQUEST).json({ ok: false, error });
      };

      const now = Date.now();
      const since =
        req.query.since ??
        new Date(now - RECENT_DEFAULT_SINCE_AGE_MS).toISOString();
      const sinceTime = new Date(since).getTime();
      if (isNaN(sinceTime)) {
        return badRequest(`Invalid since '${since}'. Use an ISO 8601 time.`);
      }
      if (sinceTime < now - RECENT_MAX_SINCE_AGE_MS) {
        return badRequest("since must be at most one day ago");
      }

      const limit =
        req.query.limit === undefined
          ? RECENT_DEFAULT_LIMIT
          : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > RECENT_MAX_LIMIT) {
        return badRequest(
          `limit must be an integer from 1 to ${RECENT_MAX_LIMIT}`,
        );
      }

      let cursor: RecentSignaturesCursor | undefined;
      if (req.query.cursor !== undefined) {
        cursor = parseRecentCursor(req.query.cursor);
        if (!cursor) {
          return badRequest(`Invalid cursor '${req.query.cursor}'`);
        }
      }

      try {
        // The time that JS checked, so Postgres reads the same time
        const rows = await database.getRecentSignatures(
          new Date(sinceTime).toISOString(),
          cursor,
          limit,
        );
        const signatures = rows.map((row) => ({
          signature: row.signature,
          signatureHash4: row.signature_hash_4,
          signatureHash32: row.signature_hash_32,
          createdAt: row.created_at,
          types: row.types,
          source:
            row.address === null
              ? null
              : {
                  name: row.contract_name,
                  chainId: row.chain_id,
                  address: row.address,
                },
        }));
        const last = signatures[signatures.length - 1];
        res.set("Cache-Control", "no-store");
        res.status(StatusCodes.OK).json({
          ok: true,
          result: {
            signatures,
            next:
              signatures.length === limit
                ? `${last.createdAt}_${last.signatureHash32}`
                : null,
          },
        });
      } catch (error) {
        logger.error("Error in getRecentSignatures", { error });
        sendSignatureApiFailure(
          res,
          "Unexpected failure while getting recent signatures",
        );
      }
    },
  };
}
