const winston = require("winston");
const chalk = require("chalk");

const rawlineFormat = winston.format.printf(
  ({ level, message, timestamp, service, ...metadata }) => {
    let msg = `${timestamp} [${level}] ${service ? service : ""} ${chalk.bold(message)}`;
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

const errorFormatter = winston.format((info) => {
  if (info.error instanceof Error) {
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

const chooseJSONFormat = () => {
  const isOnGCP = process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT;

  const gcpFormat = winston.format.printf(
    ({ level, message, timestamp, service, ...metadata }) => {
      const severityMap = {
        error: "ERROR",
        warn: "WARNING",
        info: "INFO",
        debug: "DEBUG",
        silly: "DEBUG",
      };

      const severity = severityMap[level] || "DEFAULT";
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || "database-project";

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

  return winston.format.combine(
    errorFormatter(),
    winston.format.timestamp(),
    isOnGCP ? gcpFormat : winston.format.json(),
  );
};

const jsonFormat = chooseJSONFormat();
const lineFormat = winston.format.combine(
  errorFormatter(),
  winston.format.timestamp(),
  winston.format.colorize(),
  rawlineFormat,
);

const loggerInstance = winston.createLogger({
  level: process.env.NODE_LOG_LEVEL || "info",
});

const consoleTransport = new winston.transports.Console({
  format: process.env.NODE_ENV === "production" ? jsonFormat : lineFormat,
});

loggerInstance.add(consoleTransport);

const databaseLoggerInstance = loggerInstance.child({
  service: null,
});

module.exports = {
  logger: databaseLoggerInstance,
};
