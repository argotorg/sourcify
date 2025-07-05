import { createLogger, transports, format, Logger } from "winston";
import chalk from "chalk";
import {
  setLibSourcifyLogger,
  setLibSourcifyLoggerLevel,
  ILibSourcifyLogger,
} from "@ethereum-sourcify/lib-sourcify";
import { asyncLocalStorage } from "./async-context";
import {
  setCompilersLogger,
  setCompilersLoggerLevel,
} from "@ethereum-sourcify/compilers";

export enum LogLevels {
  error = 0,
  warn = 1,
  info = 2,
  debug = 5,
  silly = 6,
}

export const validLogLevels = Object.values(LogLevels);
const loggerInstance: Logger = createLogger();

// 2024-03-06T17:04:16.375Z [warn]: [RepositoryV2Service] Storing contract address=0x5FbDB2315678afecb367f032d93F642f64180aa3, chainId=1337, matchQuality=0.5
const rawlineFormat = format.printf(
  ({ level, message, timestamp, service, traceId, ...metadata }: any) => {
    const traceIdMsg = traceId ? chalk.grey(`[traceId=${traceId}]`) : "";

    let msg = `${timestamp} [${level}] ${service ? service : ""} ${chalk.bold(
      message,
    )}`;
    if (metadata && Object.keys(metadata).length > 0) {
      msg += " - ";
      const metadataMsg = Object.entries(metadata)
        .map(([key, value]) => {
          if (typeof value === "object") {
            try {
              value = JSON.stringify(value);
            } catch (e) {
              value = "SerializationError: Unable to serialize object";
            }
          }
          return `${key}=${value}`;
        })
        .join(" | ");
      msg += chalk.grey(metadataMsg);
      msg += traceIdMsg && " - " + traceIdMsg;
    }
    return msg;
  },
);

// Error formatter, since error objects are non-enumerable and will return "{}"
const errorFormatter = format((info) => {
  if (info.error instanceof Error) {
    // Convert the error object to a plain object
    // Including standard error properties and any custom ones
    info.error = Object.assign(
      {
        message: info.error.message,
        stack: info.error.stack,
        name: info.error.name,
      },
      info.error,
    );
  }
  return info;
});

// Inject the traceId into the log message
const injectTraceId = format((info) => {
  const traceId = asyncLocalStorage.getStore()?.traceId;
  return traceId ? { ...info, traceId } : info;
});

// Choose between the GCP and the standard JSON format.
const chooseJSONFormat = () => {
  const isOnGCP = process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT;

  const gcpFormat = format.printf(
    ({ level, message, timestamp, service, traceId, ...metadata }) => {
      // Google Cloud uses a different field for indicating severity. Map `level` to `severity`
      const severityMap: { [key: string]: string } = {
        error: "ERROR",
        warn: "WARNING",
        info: "INFO",
        debug: "DEBUG",
        silly: "DEBUG", // GCP does not have an equivalent to 'silly', so map to 'DEBUG'
      };

      const severity = severityMap[level] || "DEFAULT";

      const projectId =
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        "sourcify-project";

      const logObject = {
        severity,
        message,
        service,
        timestamp,
        // Add the trace under this field to allow easy correction of traces https://cloud.google.com/run/docs/logging#correlate-logs
        "logging.googleapis.com/trace": `projects/${projectId}/traces/${traceId}`,
        ...metadata,
      };

      return JSON.stringify(logObject);
    },
  );

  return format.combine(
    errorFormatter(),
    format.timestamp(),
    injectTraceId(),
    isOnGCP ? gcpFormat : format.json(),
  );
};

const jsonFormat = chooseJSONFormat();
const lineFormat = format.combine(
  injectTraceId(),
  errorFormatter(),
  format.timestamp(),
  format.colorize(),
  rawlineFormat,
);

const consoleTransport = new transports.Console({
  // NODE_LOG_LEVEL is takes precedence, otherwise use "info" if in production, "debug" otherwise
  format: process.env.NODE_ENV === "production" ? jsonFormat : lineFormat,
});

loggerInstance.add(consoleTransport);
const serverLoggerInstance = loggerInstance.child({
  service:
    process.env.NODE_ENV === "production"
      ? "server"
      : chalk.magenta("[Server]"),
});

export default serverLoggerInstance;

export const logLevelStringToNumber = (level: string): number => {
  switch (level) {
    case "error":
      return LogLevels.error;
    case "warn":
      return LogLevels.warn;
    case "info":
      return LogLevels.info;
    case "debug":
      return LogLevels.debug;
    case "silly":
      return LogLevels.silly;
    default:
      return LogLevels.info;
  }
};

// Function to change the log level dynamically
export function setLogLevel(level: string): void {
  if (!validLogLevels.includes(level)) {
    throw new Error(
      `Invalid log level: ${level}. level can take: ${validLogLevels.join(
        ", ",
      )}`,
    );
  }
  console.warn(`Setting log level to: ${level}`);
  consoleTransport.level = level;
  process.env.NODE_LOG_LEVEL = level;
  // Also set lib-sourcify's logger level
  setLibSourcifyLoggerLevel(logLevelStringToNumber(level));
  setCompilersLoggerLevel(logLevelStringToNumber(level));
}

const makePackageLogger = (packageName: string): ILibSourcifyLogger => {
  return {
    logLevel: logLevelStringToNumber(serverLoggerInstance.level), // same as the server
    setLevel(level: number) {
      this.logLevel = level;
    },
    log(level, msg, metadata) {
      const logObject = {
        service:
          process.env.NODE_ENV === "production"
            ? packageName
            : chalk.cyan(`[${packageName}]`),
        message: msg,
        ...metadata,
      };
      if (level <= this.logLevel) {
        switch (level) {
          case 0:
            serverLoggerInstance.error(logObject);
            break;
          case 1:
            serverLoggerInstance.warn(logObject);
            break;
          case 2:
            serverLoggerInstance.info(logObject);
            break;
          // Use winston's log levels https://github.com/winstonjs/winston?tab=readme-ov-file#logging-levels
          // We don't use http (3) and verbose (4)
          case 5:
            serverLoggerInstance.debug(logObject);
            break;
          case 6:
            serverLoggerInstance.silly(logObject);
            break;
          default:
            serverLoggerInstance.info(logObject);
            break;
        }
      }
    },
  };
};

// here we override the standard LibSourcify's Logger with a custom one
setLibSourcifyLogger(makePackageLogger("LibSourcify"));
setCompilersLogger(makePackageLogger("Compilers"));
