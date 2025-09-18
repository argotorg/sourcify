import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";

export function sendSignatureApiFailure(res: Response, error: string) {
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    ok: false,
    error,
  });
}

function validateHash(hash: string): boolean {
  if (!hash.startsWith("0x")) {
    return false;
  }

  // Only accept 32 byte and 4 byte hashes
  if (hash.length !== 66 && hash.length !== 10) {
    return false;
  }

  const hexPart = hash.substring(2);
  return /^[0-9a-fA-F]+$/.test(hexPart);
}

export function validateHashQueries(
  req: Request & {
    query: { function?: string; event?: string; error?: string };
  },
  res: Response,
  next: NextFunction,
): void {
  const {
    function: functionQuery,
    event: eventQuery,
    error: errorQuery,
  } = req.query;

  const hashes = [
    ...(functionQuery?.split(",") || []),
    ...(eventQuery?.split(",") || []),
    ...(errorQuery?.split(",") || []),
  ];

  for (const hash of hashes) {
    if (!validateHash(hash)) {
      sendSignatureApiFailure(
        res,
        `Invalid hash '${hash}'. Hash must be 0x-prefixed and either be a 4 byte or 32 byte hex string.`,
      );
      return;
    }
  }

  next();
}

export function validateSearchQuery(
  req: Request & { query: { query?: string } },
  res: Response,
  next: NextFunction,
): void {
  const { query: searchQuery = "" } = req.query;

  if (!/^[a-zA-Z0-9$_()[\],*?]+$/.test(searchQuery)) {
    sendSignatureApiFailure(
      res,
      `Invalid search pattern '${searchQuery}'. Query must be a valid function signature name but may include '*' and '?' wildcards.`,
    );
    return;
  }

  next();
}
