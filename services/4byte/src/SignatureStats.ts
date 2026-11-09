import type { Logger } from "winston";
import type { SignatureDatabase } from "./SignatureDatabase";

// The response of GET /signature-database/v1/stats. The breakdown is null if the
// service has no usable base file, because a full count by type in Postgres is too
// expensive (it reads all of compiled_contracts_signatures).
export interface SignatureStatsResult {
  count: {
    function: number | null;
    event: number | null;
    error: number | null;
    unknown: number | null;
    total: number;
  };
  metadata: {
    refreshed_at: string;
  };
}

// The counts that a BigQuery scheduled query writes for all signatures with
// created_at <= t0 (see bigquery/signature-stats-base.sql). The query runs once a day.
export interface SignatureStatsBase {
  t0: Date;
  function: number;
  event: number;
  error: number;
  unknown: number;
  total: number;
}

export interface SignatureStatsOptions {
  // URL of the base file: https://... or gs://bucket/object. Without it, the
  // breakdown is always null.
  baseUrl?: string;
  baseRefreshIntervalMs?: number;
  // A base with an older t0 is not used, because the first delta count gets slow
  baseMaxAgeMs?: number;
  // How often the service checks for a new count window
  refreshIntervalMs?: number;
  // Count windows end at a multiple of this, so that all instances count the
  // same rows and give the same numbers
  countStepMs?: number;
  // The service counts only rows older than this. A row gets its created_at when
  // the insert starts, but other connections see it only after the commit.
  commitMarginMs?: number;
  now?: () => Date;
  // For tests: replace the Google endpoints that read a gs:// file
  gcsApiUrl?: string;
  metadataTokenUrl?: string;
}

// The counts in memory: all signatures with created_at <= asOf
interface Counts {
  asOf: Date;
  // t0 of the base that the counts started from. Undefined for a total-only count.
  baseT0?: Date;
  function: number | null;
  event: number | null;
  error: number | null;
  unknown: number | null;
  total: number;
  refreshedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const GCS_API_URL = "https://storage.googleapis.com";
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

// gs://bucket/object to the download URL of the Cloud Storage JSON API
export function gcsDownloadUrl(gsUrl: string, apiUrl = GCS_API_URL): string {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUrl);
  if (!match) {
    throw new Error(`Invalid gs:// URL: ${gsUrl}`);
  }
  const [, bucket, object] = match;
  return `${apiUrl}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
}

// SIGNATURE_STATS_BASE_MAX_AGE_HOURS. Staging gets few new signatures, so its
// base can be weeks old and still give a short delta.
export function parseBaseMaxAgeMs(
  hours: string | undefined,
): number | undefined {
  if (hours === undefined || hours === "") {
    return undefined;
  }
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid SIGNATURE_STATS_BASE_MAX_AGE_HOURS: ${hours}`);
  }
  return value * 60 * 60 * 1000;
}

const BASE_FIELDS = ["function", "event", "error", "unknown", "total"] as const;

// BigQuery's JSON export writes newline-delimited JSON and INT64 values as strings.
export function parseSignatureStatsBase(text: string): SignatureStatsBase {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) {
    throw new Error("Base file is empty");
  }
  const raw = JSON.parse(line) as Record<string, unknown>;

  const t0 = new Date(String(raw.t0));
  if (typeof raw.t0 !== "string" || isNaN(t0.getTime())) {
    throw new Error(`Invalid t0 in base file: ${String(raw.t0)}`);
  }

  const counts = {} as Record<(typeof BASE_FIELDS)[number], number>;
  for (const field of BASE_FIELDS) {
    const rawValue = raw[field];
    const value = Number(rawValue);
    const isNumberOrDigits =
      typeof rawValue === "number" ||
      (typeof rawValue === "string" && /^\d+$/.test(rawValue));
    if (!isNumberOrDigits || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid ${field} in base file: ${String(raw[field])}`);
    }
    counts[field] = value;
  }

  return { t0, ...counts };
}

export class SignatureStats {
  private readonly baseUrl?: string;
  private readonly baseRefreshIntervalMs: number;
  private readonly baseMaxAgeMs: number;
  private readonly refreshIntervalMs: number;
  private readonly countStepMs: number;
  private readonly commitMarginMs: number;
  private readonly now: () => Date;
  private readonly gcsApiUrl: string;
  private readonly metadataTokenUrl: string;

  private base?: SignatureStatsBase;
  private baseLoad?: Promise<void>;
  private lastBaseLoadAt?: number;
  private counts?: Counts;
  private refreshing?: Promise<void>;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly database: SignatureDatabase,
    private readonly logger: Logger,
    options: SignatureStatsOptions = {},
  ) {
    this.baseUrl = options.baseUrl;
    this.baseRefreshIntervalMs =
      options.baseRefreshIntervalMs ?? 10 * 60 * 1000;
    this.baseMaxAgeMs = options.baseMaxAgeMs ?? 2 * DAY_MS;
    this.refreshIntervalMs = options.refreshIntervalMs ?? 10 * 1000;
    this.countStepMs = options.countStepMs ?? 60 * 1000;
    this.commitMarginMs = options.commitMarginMs ?? 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.gcsApiUrl = options.gcsApiUrl ?? GCS_API_URL;
    this.metadataTokenUrl = options.metadataTokenUrl ?? METADATA_TOKEN_URL;
  }

  // Reads the base file, then starts the first count in the background. Then it
  // reads the file and adds the new rows on each interval.
  async start(): Promise<void> {
    if (this.baseUrl) {
      await this.loadBase();
      this.timers.push(
        setInterval(() => void this.loadBase(), this.baseRefreshIntervalMs),
      );
    } else {
      this.logger.info(
        "SIGNATURE_STATS_BASE_URL is not set: /stats gives no breakdown by type",
      );
    }
    void this.refresh().catch(() => undefined);
    this.timers.push(
      setInterval(
        () => void this.refresh().catch(() => undefined),
        this.refreshIntervalMs,
      ),
    );
    this.timers.forEach((timer) => timer.unref());
  }

  stop(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
  }

  // Removes the counts, so that the next request counts again. For tests.
  reset(): void {
    this.counts = undefined;
  }

  // Reads the base file. If the read fails, the service keeps the file that it has.
  loadBase(): Promise<void> {
    if (!this.baseUrl) {
      return Promise.resolve();
    }
    if (!this.baseLoad) {
      this.lastBaseLoadAt = this.now().getTime();
      this.baseLoad = this.fetchBase(this.baseUrl).finally(() => {
        this.baseLoad = undefined;
      });
    }
    return this.baseLoad;
  }

  private async fetchBase(url: string): Promise<void> {
    try {
      const response = await this.fetchBaseFile(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const base = parseSignatureStatsBase(await response.text());
      if (this.base && base.t0 < this.base.t0) {
        this.logger.warn("Base file is older than the current base, ignored", {
          t0: base.t0.toISOString(),
          currentT0: this.base.t0.toISOString(),
        });
        return;
      }
      this.base = base;
      this.logger.info("Loaded signature stats base", {
        t0: base.t0.toISOString(),
        total: base.total,
      });
    } catch (error) {
      this.logger.warn("Could not load signature stats base", {
        url,
        error: error instanceof Error ? error.message : String(error),
        currentT0: this.base?.t0.toISOString(),
      });
    }
  }

  private async fetchBaseFile(url: string): Promise<Response> {
    if (!url.startsWith("gs://")) {
      return fetch(url, {
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
    }
    // A private object, read as the service account of the Cloud Run service.
    // Private objects get no cache, so the service always reads the newest file.
    const tokenResponse = await fetch(this.metadataTokenUrl, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5000),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Metadata server: HTTP ${tokenResponse.status}`);
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as {
      access_token?: string;
    };
    if (!accessToken) {
      throw new Error("Metadata server gave no access token");
    }
    return fetch(gcsDownloadUrl(url, this.gcsApiUrl), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
  }

  // Gives the counts from memory. A request waits only if the timers did not
  // run: after a start, or when Cloud Run throttles the CPU between requests.
  async getStats(): Promise<SignatureStatsResult> {
    const now = this.now();
    if (
      this.baseUrl &&
      (this.lastBaseLoadAt === undefined ||
        now.getTime() - this.lastBaseLoadAt >= this.baseRefreshIntervalMs)
    ) {
      await this.loadBase();
    }
    if (!this.counts) {
      await this.refresh();
    } else if (this.counts.asOf < this.countUntil(now)) {
      // If the count fails, give the counts that the service has
      await this.refresh().catch(() => undefined);
    }
    const counts = this.counts!;
    // A running instance gives null like a new instance when the base gets old
    const baseTooOld =
      counts.baseT0 !== undefined &&
      now.getTime() - counts.baseT0.getTime() >= this.baseMaxAgeMs;
    return {
      count: {
        function: baseTooOld ? null : counts.function,
        event: baseTooOld ? null : counts.event,
        error: baseTooOld ? null : counts.error,
        unknown: baseTooOld ? null : counts.unknown,
        total: counts.total,
      },
      metadata: { refreshed_at: counts.refreshedAt.toISOString() },
    };
  }

  // Adds the new Postgres rows to the counts. One refresh runs at a time.
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.updateCounts()
        .catch((error) => {
          this.logger.error("Could not count signatures", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        })
        .finally(() => {
          this.refreshing = undefined;
        });
    }
    return this.refreshing;
  }

  private async updateCounts(): Promise<void> {
    const now = this.now();
    const until = this.countUntil(now);
    const base = this.newerUsableBase(now);

    if (base) {
      // Start again from the new base
      const delta =
        until > base.t0
          ? await this.database.countSignaturesBetween(base.t0, until)
          : { function: 0, event: 0, error: 0, unknown: 0, total: 0 };
      this.counts = {
        asOf: until > base.t0 ? until : base.t0,
        baseT0: base.t0,
        function: base.function + delta.function,
        event: base.event + delta.event,
        error: base.error + delta.error,
        unknown: base.unknown + delta.unknown,
        total: base.total + delta.total,
        refreshedAt: now,
      };
      return;
    }

    if (!this.counts) {
      // No usable base: count the total only
      const total = await this.database.countSignaturesUntil(until);
      this.counts = {
        asOf: until,
        function: null,
        event: null,
        error: null,
        unknown: null,
        total,
        refreshedAt: now,
      };
      return;
    }

    const counts = this.counts;
    if (until <= counts.asOf) {
      return;
    }
    if (counts.baseT0) {
      const delta = await this.database.countSignaturesBetween(
        counts.asOf,
        until,
      );
      counts.function! += delta.function;
      counts.event! += delta.event;
      counts.error! += delta.error;
      counts.unknown! += delta.unknown;
      counts.total += delta.total;
    } else {
      counts.total += await this.database.countAllSignaturesBetween(
        counts.asOf,
        until,
      );
    }
    counts.asOf = until;
    counts.refreshedAt = now;
  }

  // The end of the newest count window: a whole step, before the commit margin
  private countUntil(now: Date): Date {
    const latest = now.getTime() - this.commitMarginMs;
    return new Date(latest - (latest % this.countStepMs));
  }

  // The base, if it is newer than the base of the counts and not too old
  private newerUsableBase(now: Date): SignatureStatsBase | undefined {
    const base = this.base;
    if (!base || now.getTime() - base.t0.getTime() >= this.baseMaxAgeMs) {
      return undefined;
    }
    const currentT0 = this.counts?.baseT0;
    return currentT0 && currentT0 >= base.t0 ? undefined : base;
  }
}
