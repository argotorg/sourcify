import session from "express-session";
import logger from "../common/logger";
import type { NextFunction, Request, Response } from "express";

export default function getSessionMiddleware(
  sessionOptions: session.SessionOptions,
) {
  const sessionMiddleware = session(sessionOptions);
  // We need to wrap the sessionMiddleware in a middleware to prevent it from returning all the postgresql errors in the 500 request
  return (req: Request, res: Response, next: NextFunction) => {
    sessionMiddleware(req, res, (error) => {
      if (error) {
        logger.error("Cannot store session", {
          error,
        });
        res.status(500).send("Cannot store session");
      } else {
        next();
      }
    });
  };
}
