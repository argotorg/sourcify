import path from "path";
import express, { Request } from "express";
import cors from "cors";
import util from "util";
import * as OpenApiValidator from "express-openapi-validator";
import yamljs from "yamljs";
import { resolveRefs } from "json-refs";
import { getAddress } from "ethers";
import bodyParser from "body-parser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fileUpload = require("express-fileupload");
import {
  MemoryStore as ExpressRateLimitMemoryStore,
  rateLimit,
} from "express-rate-limit";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { asyncLocalStorage } from "../common/async-context";

// local imports
import logger from "../common/logger";
import routes from "./routes";
import genericErrorHandler from "../common/errors/GenericErrorHandler";
import { validateAddresses, validateSingleAddress } from "./common";
import { initDeprecatedRoutes } from "./deprecated.routes";
import getSessionMiddleware from "./session";
import { Services } from "./services/services";
import { StorageServiceOptions } from "./services/StorageService";
import { VerificationServiceOptions } from "./services/VerificationService";
import {
  ISolidityCompiler,
  IVyperCompiler,
  SourcifyChainMap,
} from "@ethereum-sourcify/lib-sourcify";
import { ChainRepository } from "../sourcify-chain-repository";
import { SessionOptions } from "express-session";

declare module "express-serve-static-core" {
  interface Request {
    services: Services;
  }
}

export interface ServerOptions {
  port: string | number;
  maxFileSize: number;
  rateLimit: {
    enabled: boolean;
    windowMs?: number;
    max?: number;
    whitelist?: string[];
    hideIpInLogs?: boolean;
  };
  corsAllowedOrigins: string[];
  chains: SourcifyChainMap;
  solc: ISolidityCompiler;
  vyper: IVyperCompiler;
  verifyDeprecated: boolean;
  sessionOptions: SessionOptions;
  loggingToken?: string;
}

export class Server {
  app: express.Application;
  port: string | number;
  services: Services;
  chainRepository: ChainRepository;

  constructor(
    options: ServerOptions,
    verificationServiceOptions: VerificationServiceOptions,
    storageServiceOptions: StorageServiceOptions,
  ) {
    this.port = options.port;
    logger.info("Server port set", { port: this.port });
    this.app = express();

    this.chainRepository = new ChainRepository(options.chains);

    this.services = new Services(
      verificationServiceOptions,
      storageServiceOptions,
    );

    this.app.set("chainRepository", this.chainRepository);
    this.app.set("solc", options.solc);
    this.app.set("vyper", options.vyper);
    this.app.set("verifyDeprecated", options.verifyDeprecated);
    this.app.set("services", this.services);

    this.app.use(
      bodyParser.urlencoded({
        limit: options.maxFileSize,
        extended: true,
      }),
    );
    this.app.use(bodyParser.json({ limit: options.maxFileSize }));

    // Init deprecated routes before OpenApiValidator so that it can handle the request with the defined paths.
    // initDeprecatedRoutes is a middleware that replaces the deprecated paths with the real ones.
    initDeprecatedRoutes(this.app);

    this.app.use(
      fileUpload({
        limits: { fileSize: options.maxFileSize },
        abortOnLimit: true,
      }),
    );

    // Inject the traceId to the AsyncLocalStorage to be logged.
    this.app.use((req, res, next) => {
      let traceId;
      // GCP uses the standard `traceparent` header https://www.w3.org/TR/trace-context/
      if (req.headers["traceparent"]) {
        // Apparently req.headers can be an array
        const traceparent = Array.isArray(req.headers["traceparent"])
          ? req.headers["traceparent"][0]
          : req.headers["traceparent"];
        // traceparent format is: # {version}-{trace_id}-{span_id}-{trace_flags}
        traceId = traceparent.split("-")[1];
      } else if (req.headers["x-request-id"]) {
        // continue supporting legacy `x-request-id`
        traceId = Array.isArray(req.headers["x-request-id"])
          ? req.headers["x-request-id"][0]
          : req.headers["x-request-id"];
      } else {
        traceId = uuidv4();
      }

      const context = { traceId };
      // Run the rest of the request stack in the context of the traceId
      asyncLocalStorage.run(context, () => {
        next();
      });
    });

    // Log all requests in trace mode
    this.app.use((req, res, next) => {
      const { method, path, params, headers, body } = req;
      logger.silly("Request", { method, path, params, headers, body });
      next();
    });

    // In every request support both chain and chainId
    this.app.use((req: any, res: any, next: any) => {
      if (req.body.chainId) {
        req.body.chain = req.body.chainId;
      }
      next();
    });

    this.app.use(
      OpenApiValidator.middleware({
        apiSpec: path.join(__dirname, "..", "openapi.yaml"),
        validateRequests: {
          allowUnknownQueryParameters: false,
        },
        validateResponses: false,
        ignoreUndocumented: true,
        fileUploader: false,
        validateSecurity: {
          handlers: {
            // Auth Handler for the /change-log-level endpoint
            BearerAuth: (req) => {
              const authHeader = req.headers["authorization"];
              // This is a placeholder token. In a real application, use a more secure method for managing and validating tokens.
              const token = authHeader && authHeader.split(" ")[1];

              if (!options.loggingToken) {
                return false;
              }
              return token === options.loggingToken;
            },
          },
        },
        formats: {
          "comma-separated-addresses": {
            type: "string",
            validate: (addresses: string) => validateAddresses(addresses),
          },
          address: {
            type: "string",
            validate: (address: string) => validateSingleAddress(address),
          },
          "comma-separated-sourcify-chainIds": {
            type: "string",
            validate: (chainIds: string) =>
              this.chainRepository.validateSourcifyChainIds(chainIds),
          },
          "supported-chainId": {
            type: "string",
            validate: (chainId: string) =>
              this.chainRepository.checkSupportedChainId(chainId),
          },
          // "Sourcify chainIds" include the chains that are revoked verification support, but can have contracts in the repo.
          "sourcify-chainId": {
            type: "string",
            validate: (chainId: string) =>
              this.chainRepository.checkSourcifyChainId(chainId),
          },
          "match-type": {
            type: "string",
            validate: (matchType: string) =>
              matchType === "full_match" || matchType === "partial_match",
          },
        },
      }),
    );
    // checksum addresses in every request
    this.app.use((req: any, res: any, next: any) => {
      // stateless
      if (req.body.address) {
        req.body.address = getAddress(req.body.address);
      }
      // session
      if (req.body.contracts) {
        req.body.contracts.forEach((contract: any) => {
          contract.address = getAddress(contract.address);
        });
      }
      if (req.query.addresses) {
        req.query.addresses = req.query.addresses
          .split(",")
          .map((address: string) => getAddress(address))
          .join(",");
      }
      next();
    });

    if (options.rateLimit.enabled) {
      const hideIpInLogs = options.rateLimit.hideIpInLogs;
      const limiter = rateLimit({
        windowMs: options.rateLimit.windowMs,
        max: options.rateLimit.max,
        standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
        message: {
          error:
            "You are sending too many verification requests, please slow down.",
        },
        handler: (req, res, next, options) => {
          const ip = getIp(req);
          const ipHash = ip ? hash(ip) : "";
          const ipLog = hideIpInLogs ? ipHash : ip;
          const store = options.store as ExpressRateLimitMemoryStore;
          const hits = store.hits[ip || ""];
          logger.debug("Rate limit hit", {
            method: req.method,
            path: req.path,
            ip: ipLog,
            hits,
          });
          res.status(options.statusCode).send(options.message);
        },
        keyGenerator: (req: any) => {
          return getIp(req) || new Date().toISOString();
        },
        skip: (req) => {
          const ip = getIp(req);
          const whitelist = options.rateLimit.whitelist as string[];
          for (const ipPrefix of whitelist) {
            if (ip?.startsWith(ipPrefix)) return true;
          }
          return false;
        },
      });

      this.app.all("/session/verify*", limiter);
      this.app.all("/verify*", limiter);
      this.app.post("/", limiter);
    }

    // Session API endpoints require non "*" origins because of the session cookies
    const sessionPaths = [
      "/session", // all paths /session/verify /session/input-files etc.
      // legacy endpoint naming below
      "/input-files",
      "/restart-session",
      "/verify-validated",
    ];
    this.app.use((req, res, next) => {
      // startsWith to match /session*
      if (sessionPaths.some((substr) => req.path.startsWith(substr))) {
        return cors({
          origin: options.corsAllowedOrigins,
          credentials: true,
        })(req, res, next);
      }
      // * for all non-session paths
      return cors({
        origin: "*",
      })(req, res, next);
    });

    // Need this for secure cookies to work behind a proxy. See https://expressjs.com/en/guide/behind-proxies.html
    // true means the leftmost IP in the X-Forwarded-* header is used
    // Assuming the client ip is 2.2.2.2, reverse proxy 192.168.1.5
    // for the case "X-Forwarded-For: 2.2.2.2, 192.168.1.5", we want 2.2.2.2 to be used
    this.app.set("trust proxy", true);
    // Enable session only for session endpoints
    this.app.use("/*session*", getSessionMiddleware(options.sessionOptions));

    this.app.use("/", routes);
    this.app.use(genericErrorHandler);
  }

  async listen(callback?: () => void) {
    const promisified: any = util.promisify(this.app.listen);
    await promisified(this.port);
    if (callback) callback();
  }

  // We need to resolve the $refs in the openapi file ourselves because the SwaggerUI-expresses does not do it
  async loadSwagger(root: string) {
    const options = {
      filter: ["relative", "remote"],
      loaderOptions: {
        processContent: function (res: any, callback: any) {
          callback(null, yamljs.parse(res.text));
        },
      },
      location: __dirname,
    };

    return resolveRefs(root as any, options).then(
      function (results: any) {
        return results.resolved;
      },
      function (err: any) {
        console.log(err.stack);
      },
    );
  }
}

function hash(data: string) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getIp(req: Request) {
  if (req.headers["x-forwarded-for"]) {
    return req.headers["x-forwarded-for"].toString();
  }
  return req.ip;
}
