import { createLogger, format, transports } from "winston";

const level =
  process.env.NODE_LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

const logger = createLogger({
  level,
  format:
    process.env.NODE_ENV === "production"
      ? format.combine(format.timestamp(), format.json())
      : format.combine(
          format.colorize(),
          format.timestamp(),
          format.printf(({ level: lvl, message, timestamp, ...meta }) => {
            const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
            return `${timestamp} [${lvl}] ${message}${metaString}`;
          }),
        ),
  transports: [new transports.Console()],
});

export default logger;
