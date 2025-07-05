export interface ILogger {
  logLevel: number;
  log: (level: number, message: string, metadata?: any) => void;
  setLevel: (level: number) => void;
}

// Default logger behavior
export const DefaultLogger: ILogger = {
  logLevel: 2,
  setLevel(level: number) {
    this.logLevel = level;
  },
  log(level, msg, metadata) {
    if (level <= this.logLevel) {
      let metadataMsg = '';
      if (metadata && Object.keys(metadata).length > 0) {
        metadataMsg += Object.entries(metadata)
          .map(([key, value]) => {
            if (typeof value === 'object') {
              try {
                value = JSON.stringify(value);
              } catch (e) {
                value = 'SerializationError: Unable to serialize object';
              }
            }
            return `${key}=${value}`;
          })
          .join('\t');
      }
      switch (level) {
        case 0:
          console.error(msg + ' - ' + metadataMsg);
          break;
        case 1:
          console.warn(msg + ' - ' + metadataMsg);
          break;
        case 2:
          console.info(msg + ' - ' + metadataMsg);
          break;
        // Use winston's log levels https://github.com/winstonjs/winston?tab=readme-ov-file#logging-levels
        // We don't use http (3) and verbose (4)
        case 5:
          console.debug(msg + ' - ' + metadataMsg);
          break;
        case 6:
          console.log(msg + ' - ' + metadataMsg);
          break;
        default:
          console.log(msg + ' - ' + metadataMsg);
          break;
      }
    }
  },
};

// Logger variable that will be used throughout the application
let AppLogger: ILogger = DefaultLogger;

export function setLogger(logger: ILogger) {
  AppLogger = logger;
}

export function getLevel(): number {
  return AppLogger.logLevel;
}

export function setLevel(level: number) {
  AppLogger.setLevel(level);
}

export function logError(message: string, metadata?: any) {
  AppLogger.log(0, message, metadata);
}

export function logWarn(message: string, metadata?: any) {
  AppLogger.log(1, message, metadata);
}

export function logInfo(message: string, metadata?: any) {
  AppLogger.log(2, message, metadata);
}

export function logDebug(message: string, metadata?: any) {
  AppLogger.log(5, message, metadata);
}

export function logSilly(message: string, metadata?: any) {
  AppLogger.log(6, message, metadata);
}
