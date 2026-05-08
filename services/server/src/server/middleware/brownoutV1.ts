import type { Request, Response, NextFunction } from "express";
import logger from "../../common/logger";

export interface BrownoutV1Window {
  start: string;
  end: string;
}

export interface BrownoutV1Config {
  enabled: boolean;
  windows: BrownoutV1Window[];
}

export function getActiveBrownoutV1Window(
  config: BrownoutV1Config,
): BrownoutV1Window | null {
  const now = Date.now();
  for (const window of config.windows) {
    const start = new Date(window.start).getTime();
    const end = new Date(window.end).getTime();
    if (now >= start && now < end) {
      return window;
    }
  }
  return null;
}

export function createBrownoutV1Middleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = req.app.get("brownoutV1") as BrownoutV1Config | undefined;
    if (!config?.enabled) {
      return next();
    }

    const activeWindow = getActiveBrownoutV1Window(config);
    if (!activeWindow) {
      return next();
    }

    logger.info("API v1 brownout rejection", {
      path: req.path,
      method: req.method,
      originalUrl: req.originalUrl,
      brownoutWindowEnd: activeWindow.end,
    });

    res.setHeader("Retry-After", new Date(activeWindow.end).toUTCString());
    res.setHeader("Deprecation", "true");
    res.setHeader(
      "Warning",
      '299 - "Deprecated: use v2 API. See https://sourcify.dev/server/api-docs/swagger.json"',
    );

    res.status(503).json({
      error: "Service Unavailable - API v1 Brownout",
      message:
        "API v1 is temporarily unavailable during a scheduled brownout period. Please migrate to API v2. Full API docs: https://sourcify.dev/server/api-docs/swagger.json",
      brownout: {
        currentWindow: activeWindow,
      },
    });
  };
}
