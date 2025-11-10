import type { Response, Request, NextFunction } from "express";
import type express from "express";
import { deprecatedRoutesVerifyStateless } from "./verification/verify/stateless/verify.stateless.routes";
import { deprecatedRoutesVerifySession } from "./verification/verify/session/verify.session.routes";
import { deprecatedRoutesSessionState } from "./verification/session-state/session-state.routes";
import { deprecatedRoutesRepository } from "./repository/repository.routes";

type HTTPMethod =
  | "get"
  | "post"
  | "put"
  | "delete"
  | "patch"
  | "options"
  | "head";

export const deprecatedRoutes: {
  [index: string]: { path: string; method: string };
} = {
  ...deprecatedRoutesVerifyStateless,
  ...deprecatedRoutesVerifySession,
  ...deprecatedRoutesSessionState,
  ...deprecatedRoutesRepository,
};

// Replace req.url and req.originalUrl allowing OpenApiValidator to handle deprecated routes
// otherwise creating an openapi declaration file for each deprecated route is necessary
export function initDeprecatedRoutes(app: express.Application) {
  Object.keys(deprecatedRoutes).forEach((deprecatedRoute: string) => {
    const { path, method } = deprecatedRoutes[deprecatedRoute];
    app[method as HTTPMethod](
      deprecatedRoute,
      (req: Request, res: Response, next: NextFunction) => {
        let url = path;
        if (req.originalUrl.includes("?")) {
          const query = req.originalUrl.split("?")[1];
          url += `?${query}`;
        }
        req.url = url;
        req.originalUrl = url;
        next();
      },
    );
  });
}
