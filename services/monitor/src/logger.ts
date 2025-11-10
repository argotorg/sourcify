//
// Similar to sourcify-server's logger
// Has the concept of "moduleName" for logging such as ChainMonitor
//

import type { Logger } from "winston";
import { createLogger, transports, format } from "winston";
import chalk from "chalk";
import {
  setLibSourcifyLogger,
  setLibSourcifyLoggerLevel,
} from "@ethereum-sourcify/lib-sourcify";

export enum LogLevels {
  error = 0,
  warn = 1,
  info = 2,
  debug = 5,
  silly = 6,
}

export const validLogLevels = Object.values(LogLevels);

if (
  process.env.NODE_LOG_LEVEL &&
  !validLogLevels.includes(process.env.NODE_LOG_LEVEL)
) {
  throw new Error(`Invalid log level: ${process.env.NODE_LOG_LEVEL}`);
}

const loggerInstance: Logger = createLogger({
  level:
    process.env.NODE_LOG_LEVEL ||
    (process.env.NODE_ENV === "production" ? "info" : "debug"),
});

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

// 2024-03-06T17:04:16.375Z [warn]: [Monitor] [ChainMonitor #1115511] Storing contract address=0x5FbDB2315678afecb367f032d93F642f64180aa3, chainId=1337, matchQuality=0.5
const rawlineFormat = format.printf(
  ({ level, message, timestamp, service, moduleName, ...metadata }: any) => {
    let msg = `${timestamp} [${level}]: ${service ? service : ""} ${
      moduleName ? chalk.magenta(`[${moduleName}]`) : ""
    } ${chalk.bold(message)}`;
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
    }
    return msg;
  },
);

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
    isOnGCP ? gcpFormat : format.json(),
  );
};

const jsonFormat = chooseJSONFormat();
const lineFormat = format.combine(
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
const monitorLoggerInstance = loggerInstance.child({
  service:
    process.env.NODE_ENV === "production" ? "monitor" : chalk.blue("[Monitor]"),
});

export default monitorLoggerInstance;

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
}

// here we override the standard LibSourcify's Logger with a custom one
setLibSourcifyLogger({
  logLevel: logLevelStringToNumber(monitorLoggerInstance.level), // same as the monitor
  setLevel(level: number) {
    this.logLevel = level;
  },
  log(level, msg, metadata) {
    const logObject = {
      service:
        process.env.NODE_ENV === "production"
          ? "LibSourcify"
          : chalk.cyan("[LibSourcify]"),
      message: msg,
      ...metadata,
    };
    if (level <= this.logLevel) {
      switch (level) {
        case 0:
          monitorLoggerInstance.error(logObject);
          break;
        case 1:
          monitorLoggerInstance.warn(logObject);
          break;
        case 2:
          monitorLoggerInstance.info(logObject);
          break;
        // Use winston's log levels https://github.com/winstonjs/winston?tab=readme-ov-file#logging-levels
        // We don't use http (3) and verbose (4)
        case 5:
          monitorLoggerInstance.debug(logObject);
          break;
        case 6:
          monitorLoggerInstance.silly(logObject);
          break;
        default:
          monitorLoggerInstance.info(logObject);
          break;
      }
    }
  },
});
