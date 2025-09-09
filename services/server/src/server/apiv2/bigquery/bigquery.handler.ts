import { StatusCodes } from "http-status-codes";
import logger from "../../../common/logger";
import { Request } from "express";
import { TypedResponse } from "../../types";
import {
  getBigQuery,
  BQ_LOCATION,
  BQ_MAX_BYTES_BILLED,
  BQ_MAX_BYTES_BILLED_MIB,
  toMiB,
} from "../../gcp/bigqueryClient";
import { BQ_ALLOWLIST_DATASETS } from "../../gcp/bigqueryClient";

interface PostBigQueryRequest extends Request {}

type BigQueryBody =
  | {
      ok: true;
      jobId: string;
      estimatedBytes: string;
      estimatedMiB: number;
      billedBytes: string;
      billedMiB: number;
      capBytes: string;
      capMiB: number;
      rowCount: number;
      rows: any[];
    }
  | {
      ok: true;
      dryRunOnly: true;
      estimatedBytes: string;
      estimatedMiB: number;
      capBytes: string;
      capMiB: number;
    }
  | {
      ok: false;
      error?: string;
      reason?: string;
      estimatedBytes?: string;
      estimatedMiB?: number;
      capBytes?: string;
      capMiB?: number;
      message?: string;
    };

type PostBigQueryResponse = TypedResponse<BigQueryBody>;

type RunQueryBody = {
  sql: string;
  params?: Record<string, unknown>;
  maxRows?: number;
  dryRunOnly?: boolean;
};

export async function postBigQueryEndpoint(
  req: PostBigQueryRequest,
  res: PostBigQueryResponse,
): Promise<void> {
  try {
    const body = (req.body || {}) as RunQueryBody;
    const sql = (body.sql || "").trim();
    const params = body.params || {};
    const maxRows = Math.min(Math.max(Number(body.maxRows ?? 1000), 1), 5000);
    const bigquery = await getBigQuery();

    if (!sql) {
      res
        .status(StatusCodes.BAD_REQUEST)
        .json({ ok: false, error: "Missing 'sql'." });
      return;
    }

    // We use dry run to estimate the bytes the query would process
    // and to validate the query (syntax, referenced tables, permissions, etc).
    const [dryJob] = await bigquery.createQueryJob({
      query: sql,
      params,
      location: BQ_LOCATION,
      useLegacySql: false,
      dryRun: true,
      maximumBytesBilled: BQ_MAX_BYTES_BILLED.toString(),
    });
    const qstats = (dryJob as any).metadata?.statistics?.query || {};
    const statementType = (qstats.statementType || "").toString();

    // If the service account has access to insert/update/delete, the dry run will succeed otherwise it will fail with 403
    // In the case it succeed we need to make sure only SELECT statements are allowed and only on allowed datasets

    // Enforce SELECT-only queries
    if (statementType !== "SELECT") {
      res.status(StatusCodes.BAD_REQUEST).json({
        ok: false,
        error: `Only SELECT queries are allowed (got: ${statementType || "unknown"}).`,
      });
      return;
    }

    // Enforce dataset allowlist using referenced tables from dry run
    if (BQ_ALLOWLIST_DATASETS.length) {
      const tables = (qstats.referencedTables || []) as Array<{
        projectId: string;
        datasetId: string;
        tableId: string;
      }>;
      const referencedDatasets = Array.from(
        new Set(
          (Array.isArray(tables) ? tables : []).map(
            (t) => `${t.projectId}.${t.datasetId}`,
          ),
        ),
      );
      const allAllowlisted = referencedDatasets.every((ds) =>
        BQ_ALLOWLIST_DATASETS.includes(ds),
      );
      if (!allAllowlisted) {
        res.status(StatusCodes.FORBIDDEN).json({
          ok: false,
          error: "Query references non-allowlisted datasets.",
        });
        return;
      }
    }

    // Enforce estimated bytes within cap
    const estBytes = BigInt(
      (dryJob as any).metadata?.statistics?.totalBytesProcessed ?? "0",
    );
    if (estBytes > BQ_MAX_BYTES_BILLED) {
      res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        ok: false,
        reason: "ESTIMATE_EXCEEDS_CAP",
        estimatedBytes: estBytes.toString(),
        estimatedMiB: toMiB(estBytes),
        capBytes: BQ_MAX_BYTES_BILLED.toString(),
        capMiB: BQ_MAX_BYTES_BILLED_MIB,
        message: `Estimated bytes (${toMiB(estBytes).toFixed(2)} MiB) exceed cap (${BQ_MAX_BYTES_BILLED_MIB} MiB).`,
      });
      return;
    }

    if (body.dryRunOnly) {
      res.status(StatusCodes.OK).json({
        ok: true,
        dryRunOnly: true,
        estimatedBytes: estBytes.toString(),
        estimatedMiB: toMiB(estBytes),
        capBytes: BQ_MAX_BYTES_BILLED.toString(),
        capMiB: BQ_MAX_BYTES_BILLED_MIB,
      });
      return;
    }

    // ---- EXECUTION (capped) ----
    // Use createQueryJob + getQueryResults to ensure we have a Job instance
    const [job] = await bigquery.createQueryJob({
      query: sql,
      params,
      location: BQ_LOCATION,
      useLegacySql: false,
      maximumBytesBilled: BQ_MAX_BYTES_BILLED.toString(),
    });
    const [rows] = await (job as any).getQueryResults({ maxResults: maxRows });
    const [meta] = await (job as any).getMetadata();
    const billedBytesRaw =
      meta?.statistics?.query?.totalBytesProcessed ??
      meta?.statistics?.totalBytesProcessed ??
      "0";
    const billedBytes = BigInt(billedBytesRaw);

    // Cap rows returned to client
    const outRows = Array.isArray(rows) ? rows.slice(0, maxRows) : [];

    res.status(StatusCodes.OK).json({
      ok: true,
      jobId: (job as any).id,
      estimatedBytes: estBytes.toString(),
      estimatedMiB: toMiB(estBytes),
      billedBytes: billedBytes.toString(),
      billedMiB: toMiB(billedBytes),
      capBytes: BQ_MAX_BYTES_BILLED.toString(),
      capMiB: BQ_MAX_BYTES_BILLED_MIB,
      rowCount: outRows.length,
      rows: outRows,
    });
    return;
  } catch (err: any) {
    const code = err.code;
    const message = err?.message || "BigQuery error";
    const reason =
      (err?.errors && err.errors[0]?.reason) || err?.reason || undefined;

    logger.error("postBigQueryEndpoint", { code, reason, message });
    // When query tries to access a table without permissions or insert/update/delete
    if (code === 403) {
      res.status(StatusCodes.FORBIDDEN).json({
        ok: false,
        error: "Your query cannot be executed (access denied).",
      });
      return;
    }

    if (reason === "invalidQuery") {
      res.status(StatusCodes.FORBIDDEN).json({
        ok: false,
        error: message,
      });
      return;
    }

    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ ok: false, error: "Unknown BigQuery error" });
    return;
  }
}
