import type { Logger } from "winston";
import { createLogger, transports, format } from "winston";
import chalk from "chalk";

export enum LogLevels {
  error = 0,
  warn = 1,
  info = 2,
  debug = 5,
  silly = 6,
}

export const validLogLevels = Object.values(LogLevels);
const loggerInstance: Logger = createLogger();

// 2024-03-06T17:04:16.375Z [warn]: [4byteService] Storing signature hash=0x1234567890abcdef, signature=transfer(address,uint256)
const rawlineFormat = format.printf(
  ({ level, message, timestamp, service, ...metadata }: any) => {
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

// Choose between the GCP and the standard JSON format.
const chooseJSONFormat = () => {
  const isOnGCP = process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT;

  const gcpFormat = format.printf(
    ({ level, message, timestamp, service, ...metadata }) => {
      // Google Cloud uses a different field for indicating severity. Map `level` to `severity`
      const severityMap: { [key: string]: string } = {
        error: "ERROR",
        warn: "WARNING",
        info: "INFO",
        debug: "DEBUG",
        silly: "DEBUG", // GCP does not have an equivalent to 'silly', so map to 'DEBUG'
      };

      const severity = severityMap[level] || "DEFAULT";

      const logObject = {
        severity,
        message,
        service,
        timestamp,
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
const fourBytesLoggerInstance = loggerInstance.child({
  service:
    process.env.NODE_ENV === "production" ? "4byte" : chalk.blue("[4byte]"),
});

export default fourBytesLoggerInstance;

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
}
