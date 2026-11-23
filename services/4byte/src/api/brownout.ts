import type { Request, Response, NextFunction } from "express";

export interface BrownoutWindow {
  start: string;
  end: string;
}

// Windows per deprecated host name, in lower case
export type BrownoutConfig = Record<string, BrownoutWindow[]>;

const NEW_API_URL = "https://api.4byte.sourcify.dev";
const SCHEDULE_URL = "https://github.com/argotorg/sourcify/issues/3061";
// Date of the deprecation issue, as Unix seconds (RFC 9745)
const DEPRECATED_SINCE = Date.parse("2026-11-10T00:00:00Z") / 1000;

export function getActiveBrownoutWindow(
  windows: BrownoutWindow[],
  now: number = Date.now(),
): BrownoutWindow | null {
  for (const window of windows) {
    const start = new Date(window.start).getTime();
    const end = new Date(window.end).getTime();
    if (now >= start && now < end) {
      return window;
    }
  }
  return null;
}

export function createBrownoutMiddleware(
  config: BrownoutConfig,
  now: () => number = Date.now,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const host = req.hostname?.toLowerCase();
    const windows = host ? config[host] : undefined;
    if (!host || !windows?.length) {
      return next();
    }

    res.setHeader("Deprecation", `@${DEPRECATED_SINCE}`);
    // The last window is the permanent shutdown
    const shutdown = windows[windows.length - 1].start;
    res.setHeader("Sunset", new Date(shutdown).toUTCString());
    res.setHeader(
      "Warning",
      `299 - "Deprecated: ${host} will shut down. Use ${NEW_API_URL}. See ${SCHEDULE_URL}"`,
    );

    const activeWindow = getActiveBrownoutWindow(windows, now());
    if (!activeWindow) {
      return next();
    }

    res.setHeader("Retry-After", new Date(activeWindow.end).toUTCString());
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({
      ok: false,
      error: `Service Unavailable - ${host} Brownout`,
      message: `${host} is temporarily unavailable during a scheduled brownout period. Please migrate to ${NEW_API_URL}. It is the same API, only the host name changes. Schedule: ${SCHEDULE_URL}`,
      brownout: {
        currentWindow: activeWindow,
      },
    });
  };
}
